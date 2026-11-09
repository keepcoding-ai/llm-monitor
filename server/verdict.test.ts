// Testes do veredito (plano §11, passo 1): 8 cenários + 6 de hora humana + 1 de sessões divergentes.
// Rodar: npm test  (node --import tsx --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict, counterSeries, humanTime, otherAccounts, robustSlope, whenFull, type Reading } from "./verdict.ts";
import { band, shouldNotify } from "../shared/notify.ts";
import { describeShape } from "./oauth-usage.ts";
import { officialReading, officialSig, pickLatest, shouldRecordOfficial } from "./official-reading.ts";

const L = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const iso = (t: number) => new Date(t).toISOString();
const MIN = 60_000;

// quinta 01/10/2026 14:00; semana começou quarta 30/09 15:00, renova quarta 07/10 15:00
const NOW = L(2026, 10, 1, 14);
const WEEK_RESET = iso(L(2026, 10, 7, 15));
const FIVE_RESET = iso(L(2026, 10, 1, 16, 20));
const OTHER_WEEK_RESET = iso(L(2026, 10, 5, 9));

function series(fromPct: number, toPct: number, minutes: number, five?: { from: number; to: number; reset: string }, session = "s-aaaa"): Reading[] {
  const out: Reading[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = NOW - minutes * MIN + (i * minutes * MIN) / steps;
    out.push({
      at: iso(t),
      session,
      seven: { usedPct: fromPct + ((toPct - fromPct) * i) / steps, resetsAt: WEEK_RESET },
      five: five ? { usedPct: five.from + ((five.to - five.from) * i) / steps, resetsAt: five.reset } : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------- veredito (8)

test("1. semana esgota sábado à noite: a frase cita a semana, ◀ na semana", () => {
  // sessão: 44 % subindo 13 %/h (não esgota antes de 16:20); semana: 30 % com média 30/23h → esgota sáb ~19:40
  const h = series(29.5, 30, 60, { from: 31, to: 44, reset: FIVE_RESET });
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h });
  assert.equal(v.state, "attention");
  assert.equal(v.decisive, "7d");
  assert.match(v.headline, /a semana esgota sábado à noite, antes de renovar quarta-feira, 15:00/);
  assert.match(v.short, /^⚠ semana esgota sáb\/noite$/);
  assert.ok(v.short.length <= 40);
  const w5 = v.windows.find((w) => w.id === "5h")!;
  assert.equal(Math.round(w5.ratePctPerHour!), 13);
  assert.equal(w5.exhausts, false);
});

test("2. uma só leitura: semana projeta pela média, sessão sem pontos suficientes", () => {
  const one: Reading = { at: iso(NOW - MIN), session: "s-1", seven: { usedPct: 10, resetsAt: WEEK_RESET }, five: { usedPct: 20, resetsAt: FIVE_RESET } };
  const v = computeVerdict({ now: NOW, latest: one, history: [one] });
  const w7 = v.windows.find((w) => w.id === "7d")!;
  const w5 = v.windows.find((w) => w.id === "5h")!;
  assert.ok(w7.ratePctPerHour! > 0);
  assert.ok(w7.projAtReset != null || w7.hitsAt != null);
  assert.equal(w5.ratePctPerHour, null);
  assert.equal(w5.note, "ritmo ainda sem pontos suficientes");
});

test("3. sem linha de status: estado sem leitura com o caminho para Ajustes", () => {
  const v = computeVerdict({ now: NOW, latest: null, history: [] });
  assert.equal(v.state, "missing");
  assert.match(v.headline, /Ative a linha de status do monitor — está em Ajustes/);
  assert.equal(v.short, "");
});

test("4. leitura com mais de 15 min: selo stale, frase preservada", () => {
  const h = series(29.5, 30, 60).map((r) => ({ ...r, at: iso(Date.parse(r.at) - 20 * MIN) }));
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h });
  assert.equal(v.state, "stale");
  assert.equal(v.underlying, "attention");
  assert.match(v.headline, /semana esgota/);
});

test("5. janela em 100 %: sem Claude até o reset", () => {
  const r: Reading = { at: iso(NOW - MIN), seven: { usedPct: 40, resetsAt: WEEK_RESET }, five: { usedPct: 100, resetsAt: FIVE_RESET } };
  const v = computeVerdict({ now: NOW, latest: r, history: [r] });
  assert.equal(v.state, "exhausted");
  assert.match(v.headline, /^Sem Claude até hoje às 16:20\. A sessão de 5 h esgotou\./);
});

test("6. sessão esgota em menos de 1 h: crítico, a sessão decide (menor hitsAt)", () => {
  const h = series(29.9, 30, 60, { from: 40, to: 80, reset: FIVE_RESET }); // 40 %/h → 100 % em 30 min
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h });
  assert.equal(v.state, "critical");
  assert.equal(v.decisive, "5h");
  assert.match(v.headline, /^Crítico\. Nesse ritmo, a sessão de 5 h esgota em cerca de 30 min/);
});

test("7. nenhuma janela esgota: tranquilo, projeção na renovação", () => {
  // semana em 5 % com 23 h decorridas → ~ 0,22 %/h → chega com ~ 33 %
  const h = series(4.9, 5, 60, { from: 10, to: 12, reset: FIVE_RESET });
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h, lastUsageAt: NOW - MIN });
  assert.equal(v.state, "ok");
  assert.match(v.headline, /^Tranquilo\. Nesse ritmo você chega à renovação de/);
  assert.match(v.short, /^✓ chega /);
});

test("8. ritmo parado: tranquilo com minutos sem consumo", () => {
  const h = series(5, 5, 60, { from: 12, to: 12, reset: FIVE_RESET });
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h, lastUsageAt: NOW - 25 * MIN });
  assert.equal(v.state, "ok");
  assert.match(v.headline, /^Tranquilo\. Sem consumo há 25 min; sessão de 5 h em 12 %\./);
});

// ---------------------------------------------------------------- hora humana (6)

test("hora: projeção no mesmo dia → período", () => assert.equal(humanTime(L(2026, 10, 1, 19, 20), NOW, "proj"), "hoje à noite"));
test("hora: projeção amanhã → período", () => assert.equal(humanTime(L(2026, 10, 2, 9, 12), NOW, "proj"), "amanhã de manhã"));
test("hora: projeção em < 2 h → duração aproximada", () => {
  assert.equal(humanTime(NOW + 25 * MIN, NOW, "proj"), "em cerca de 25 min");
  assert.equal(humanTime(NOW + 90 * MIN, NOW, "proj"), "em cerca de 1 h");
});
test("hora: reset no mesmo dia → hoje às (exato)", () => assert.equal(humanTime(L(2026, 10, 1, 19, 20), NOW, "reset"), "hoje às 19:20"));
test("hora: dia seguinte → amanhã às", () => assert.equal(humanTime(L(2026, 10, 2, 9), NOW, "reset"), "amanhã às 09:00"));
test("hora: projeção em 2–6 dias → período", () => assert.equal(humanTime(L(2026, 10, 3, 20), NOW, "proj"), "sábado à noite"));
test("hora: madrugada", () => assert.equal(humanTime(L(2026, 10, 4, 3), NOW, "proj"), "domingo de madrugada"));
test("hora: reset em 2–6 dias → dia e hora exata", () => assert.equal(humanTime(L(2026, 10, 7, 15), NOW, "reset"), "quarta-feira, 15:00"));
test("hora: 7 dias ou mais → data", () => assert.equal(humanTime(L(2026, 10, 8, 10), NOW, "reset"), "8 de out."));

// ---------------------------------------------------------------- conta inferida (3)

test("mesma conta, 3 sessões intercaladas com uma ociosa atrasada: veredito e ritmo estáveis", () => {
  // contador real sobe 0,6 pt/min (36 %/h); a sessão s3 fica ociosa repetindo 6 %
  const rows: Reading[] = [];
  for (let i = 0; i <= 30; i++) {
    const at = NOW - (30 - i) * MIN;
    const sess = ["s1", "s2", "s3"][i % 3];
    const v = sess === "s3" ? 6 : 29 + 0.6 * i;
    rows.push({ at: iso(at), session: sess, five: { usedPct: v, resetsAt: FIVE_RESET }, seven: { usedPct: 30, resetsAt: WEEK_RESET } });
  }
  const states = new Set<string>();
  const rates: number[] = [];
  // o veredito é recalculado com cada sessão como "mais recente"
  for (let k = 0; k < 3; k++) {
    const hist = rows.slice(0, rows.length - k);
    const v = computeVerdict({ now: NOW, latest: hist.at(-1)!, history: hist });
    states.add(v.state);
    const w5 = v.windows.find((w) => w.id === "5h")!;
    assert.ok(w5.usedPct! >= 45, `usado ${w5.usedPct}`);
    rates.push(w5.ratePctPerHour!);
  }
  assert.equal(states.size, 1);
  for (const r of rates) assert.ok(Math.abs(r - 36) < 1, `ritmo ${r}`);
});

test("pico isolado não move o contador", () => {
  // a sessão s1 informou 90 e depois 12: o 90 foi falha (o contador não desce)
  const pts = [10, 11, 90, 12, 13].map((v, i) => ({ t: NOW + i * MIN, v, s: "s1" }));
  assert.deepEqual(counterSeries(pts).map((p) => p.v), [10, 11, 12, 13]);
  const r = robustSlope(counterSeries(pts))!;
  assert.ok(r > 30 && r <= 60, `ritmo ${r}`);
  // sessão ociosa atrasada (outra sessão, valor menor) sai; o valor alto real fica
  assert.deepEqual(counterSeries([{ t: NOW, v: 29, s: "a" }, { t: NOW + MIN, v: 6, s: "b" }, { t: NOW + 2 * MIN, v: 6, s: "b" }]).map((p) => p.v), [29]);
});

test("renovação diferente = outra conta: aviso, e o veredito segue a mais recente", () => {
  const a: Reading = { at: iso(NOW - 2 * MIN), session: "s-aaaa", seven: { usedPct: 29, resetsAt: WEEK_RESET } };
  const b: Reading = { at: iso(NOW - MIN), session: "s-bbbb", seven: { usedPct: 6, resetsAt: OTHER_WEEK_RESET } };
  const o = otherAccounts([a, b], NOW);
  assert.equal(o?.active, b);
  assert.equal(o?.other, a);
  const v = computeVerdict({ now: NOW, latest: b, history: [a, b] });
  assert.equal(v.windows.find((w) => w.id === "7d")!.usedPct, 6);
  // mesma renovação (dentro da tolerância), porcentagens diferentes: mesma conta, sem aviso
  const c: Reading = { ...b, seven: { usedPct: 6, resetsAt: new Date(Date.parse(WEEK_RESET) + 30_000).toISOString() } };
  assert.equal(otherAccounts([a, c], NOW), null);
  assert.equal(computeVerdict({ now: NOW, latest: c, history: [a, c] }).windows.find((w) => w.id === "7d")!.usedPct, 29);
});

// ---------------------------------------------------------------- notificação (regra do passo 6)

test("notificação: uma por subida de estado; sem repetição; stale não conta", () => {
  const s = (state: string, p5 = 0) => ({ state, bands: { "5h": band(p5) } });
  assert.equal(shouldNotify(null, s("ok")), null);
  assert.equal(shouldNotify(s("missing"), s("ok")), null);
  assert.equal(shouldNotify(s("ok"), s("attention")), "estado");
  assert.equal(shouldNotify(s("attention"), s("attention")), null);
  assert.equal(shouldNotify(s("ok", 60), s("ok", 72)), "faixa:5h");
  assert.equal(shouldNotify(s("ok", 72), s("ok", 75)), null);
});

test("hora: passado recente (desde) → ontem às / dia da semana", () => {
  assert.equal(humanTime(L(2026, 9, 30, 15), NOW, "reset"), "ontem às 15:00");
  assert.equal(humanTime(L(2026, 9, 28, 15), NOW, "reset"), "segunda-feira, 15:00");
});

test("Fable manual: entra com % e expira na renovação semanal", () => {
  const r: Reading = { at: iso(NOW - MIN), seven: { usedPct: 10, resetsAt: WEEK_RESET } };
  const v = computeVerdict({ now: NOW, latest: r, history: [r], fableManual: { pct: 20, at: iso(NOW - 5 * MIN), resetsAt: WEEK_RESET } });
  const f = v.windows.find((w) => w.id === "fable-7d")!;
  assert.equal(f.usedPct, 20);
  assert.equal(f.source, "manual");
  const after = computeVerdict({ now: Date.parse(WEEK_RESET) + MIN, latest: r, history: [r], fableManual: { pct: 20, at: iso(NOW), resetsAt: WEEK_RESET } });
  assert.equal(after.windows.find((w) => w.id === "fable-7d"), undefined);
});

// ---------------------------------------------------------------- fonte oficial primária (F2/F3)

const official = (at: number, over: Partial<Reading> = {}): Reading => ({
  at: iso(at),
  session: null,
  source: "official",
  seven: { usedPct: 20, resetsAt: WEEK_RESET },
  five: { usedPct: 10, resetsAt: FIVE_RESET },
  ...over,
});
const OLD_STATUSLINE: Reading = { at: iso(L(2026, 9, 14, 10, 4)), session: "s-old", seven: { usedPct: 30, resetsAt: iso(L(2026, 9, 16, 12)) }, five: { usedPct: 40, resetsAt: iso(L(2026, 9, 14, 15)) } };

test("oficial primária: as janelas 5 h e semana saem rotuladas como oficial, não statusline", () => {
  const o = official(NOW - MIN);
  const v = computeVerdict({ now: NOW, latest: o, history: [o] });
  assert.equal(v.windows.find((w) => w.id === "5h")!.source, "official");
  assert.equal(v.windows.find((w) => w.id === "7d")!.source, "official");
  // leitura sem origem (histórico antigo, statusline) continua rotulada statusline
  const sl: Reading = { at: iso(NOW - MIN), session: "s-1", seven: { usedPct: 10, resetsAt: WEEK_RESET }, five: { usedPct: 20, resetsAt: FIVE_RESET } };
  const v2 = computeVerdict({ now: NOW, latest: sl, history: [sl] });
  assert.equal(v2.windows.find((w) => w.id === "7d")!.source, "statusline");
});

test("statusline velha + oficial fresca: a oficial é a leitura e o veredito não fica stale", () => {
  const o = official(NOW - 2 * MIN);
  const picked = pickLatest(OLD_STATUSLINE, o, NOW);
  assert.equal(picked, o);
  const v = computeVerdict({ now: NOW, latest: picked, history: [OLD_STATUSLINE, o] });
  assert.notEqual(v.state, "stale");
  assert.equal(v.readAt, o.at);
  // sem oficial utilizável, a statusline de 17 dias segue valendo — e aí o veredito é stale
  const alone = pickLatest(OLD_STATUSLINE, null, NOW);
  assert.equal(alone, OLD_STATUSLINE);
  assert.equal(computeVerdict({ now: NOW, latest: alone, history: [OLD_STATUSLINE] }).state, "stale");
  // oficial velha (> 15 min) mas mais nova que a statusline: ainda é a melhor leitura
  const oldOff = official(NOW - 40 * MIN);
  assert.equal(pickLatest(OLD_STATUSLINE, oldOff, NOW), oldOff);
  // statusline fresca vence oficial velha
  const freshSl: Reading = { ...OLD_STATUSLINE, at: iso(NOW - MIN) };
  assert.equal(pickLatest(freshSl, oldOff, NOW), freshSl);
});

test("5 h ausente da leitura oficial: nota neutra, sem 'aguardando' nem erro", () => {
  const o = official(NOW - MIN, { five: undefined });
  const v = computeVerdict({ now: NOW, latest: o, history: [o] });
  const w5 = v.windows.find((w) => w.id === "5h")!;
  assert.equal(w5.usedPct, null);
  assert.equal(w5.source, "official");
  assert.equal(w5.note, "o fornecedor não está computando esta janela no momento");
  assert.doesNotMatch(w5.note!, /aguardando|erro|falh/i);
  assert.notEqual(v.state, "missing"); // a semana segue valendo
});

test("5 h com reset no passado: renovada (outra circunstância)", () => {
  const o = official(NOW - MIN, { five: { usedPct: 60, resetsAt: iso(NOW - 30 * MIN) } });
  const w5 = computeVerdict({ now: NOW, latest: o, history: [o] }).windows.find((w) => w.id === "5h")!;
  assert.equal(w5.note, "renovada — aguardando a primeira leitura");
});

test("leitura oficial vira Reading só com janela; ausência não é erro", () => {
  const ok = { state: "ok" as const, at: iso(NOW), keys: [], seven: { usedPct: 5, resetsAt: WEEK_RESET } };
  assert.deepEqual(officialReading(ok), { at: iso(NOW), session: null, source: "official", five: undefined, seven: ok.seven });
  assert.equal(officialReading({ state: "unavailable", at: iso(NOW), keys: [], reason: "HTTP 401" }), null);
  assert.equal(officialReading({ state: "ok", at: iso(NOW), keys: [] }), null);
  assert.equal(officialReading(null), null);
});

test("histórico oficial: grava na primeira, quando muda e a cada 15 min; não a cada poll", () => {
  const a = official(NOW);
  const sig = officialSig(a);
  assert.equal(shouldRecordOfficial(null, a, NOW), true);
  assert.equal(shouldRecordOfficial({ sig, t: NOW }, official(NOW + MIN), NOW + MIN), false);
  assert.equal(shouldRecordOfficial({ sig, t: NOW }, official(NOW + 14 * MIN), NOW + 14 * MIN), false);
  assert.equal(shouldRecordOfficial({ sig, t: NOW }, official(NOW + 15 * MIN), NOW + 15 * MIN), true);
  const moved = official(NOW + MIN, { seven: { usedPct: 21, resetsAt: WEEK_RESET } });
  assert.equal(shouldRecordOfficial({ sig, t: NOW }, moved, NOW + MIN), true);
});

test("leituras oficiais no histórico alimentam o ritmo da semana e não quebram a série", () => {
  // 2 h de leituras oficiais (sem sessão), semana subindo 1 pt/h: o ritmo recente é medido, não só a média
  const hist: Reading[] = [];
  for (let i = 0; i <= 8; i++) hist.push(official(NOW - (8 - i) * 15 * MIN, { seven: { usedPct: 20 + i * 0.25, resetsAt: WEEK_RESET }, five: undefined }));
  const v = computeVerdict({ now: NOW, latest: hist.at(-1)!, history: hist });
  const w7 = v.windows.find((w) => w.id === "7d")!;
  assert.ok(w7.rateRecentPctPerHour != null && Math.abs(w7.rateRecentPctPerHour - 1) < 0.1, `recente ${w7.rateRecentPctPerHour}`);
  assert.equal(w7.source, "official");
});

test("dado velho nomeia a data, não só a hora", () => {
  assert.match(whenFull(OLD_STATUSLINE.at, NOW), /^14\/09 às \d{2}:\d{2} \(há 17 dias\)$/);
  assert.match(whenFull(iso(NOW - 2 * 3600_000), NOW), /^01\/10 às \d{2}:\d{2}$/);
});

test("F1: forma da resposta oficial só tem nomes e tipos, nunca valores", () => {
  const j = { five_hour: null, seven_day: { utilization: 42.5, resets_at: "2026-11-12T15:00:00Z" }, limits: [{ kind: "weekly_scoped", percent: 77, scope: { model: { display_name: "Fable" } } }, { kind: "weekly" }], extra_usage: 12345 };
  const d = describeShape(j);
  assert.equal(d.shape.five_hour, "null");
  assert.equal(d.shape.seven_day, "object{utilization,resets_at}");
  assert.equal(d.shape.limits, "array(2)");
  assert.deepEqual(d.limitKinds, ["weekly_scoped:Fable", "weekly"]);
  assert.doesNotMatch(JSON.stringify(d), /42\.5|77|12345|2026-11-12/);
});

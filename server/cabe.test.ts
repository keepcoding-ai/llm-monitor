// Testes do Cabe? (plano §11, passo 3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCabe, type Cabe } from "../shared/cabe.ts";
import { learnRate, percentile } from "./cabe.ts";
import { computeVerdict, type Reading } from "./verdict.ts";

const NOW = new Date(2026, 9, 1, 14).getTime();
const WEEK_RESET = new Date(2026, 9, 7, 15).toISOString();
const iso = (t: number) => new Date(t).toISOString();
const base: Cabe = { presets: [], generic: false, usdPerPctWeek: 10, usdPerPct5h: 3, pairsWeek: 12, pairs5h: 20 };
const reading = (week: number, ratePerH: number): Reading[] =>
  Array.from({ length: 7 }, (_, i) => ({ at: iso(NOW - (6 - i) * 10 * 60_000), session: "s1", seven: { usedPct: week - ratePerH * ((6 - i) / 6), resetsAt: WEEK_RESET } }));

test("com conversão aprendida: resposta em % da semana e da sessão", () => {
  const h = reading(10, 0.05);
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h });
  const a = answerCabe(40, base, v, NOW);
  assert.equal(a.pctWeek, 4);
  assert.ok(Math.abs(a.pct5h! - 13.33) < 0.01);
  assert.match(a.after, /semana em 14 % — você ainda chega/);
});

test("sem leituras suficientes: só US$ (sem %)", () => {
  const a = answerCabe(40, { ...base, usdPerPctWeek: null, usdPerPct5h: null, pairsWeek: 3 }, null, NOW);
  assert.equal(a.pctWeek, null);
  assert.equal(a.after, "");
});

test("time de agentes quando a semana já esgota: melhor com Sonnet ou depois do reset", () => {
  const h = reading(30, 1); // média ~1,3 %/h → esgota sábado
  const v = computeVerdict({ now: NOW, latest: h.at(-1)!, history: h });
  assert.ok(v.windows.find((w) => w.id === "7d")!.exhausts);
  const a = answerCabe(300, base, v, NOW);
  assert.match(a.advice!, /^Melhor rodar com Sonnet ou depois de quarta-feira, 15:00\.$/);
  assert.equal(a.fits, false);
});

test("conversão aprendida: pares por sessão, regressão pela origem; precisa de 6 pares", () => {
  const rows: Reading[] = [];
  for (let i = 0; i <= 8; i++) rows.push({ at: iso(NOW - (8 - i) * 30 * 60_000), session: "s1", seven: { usedPct: 10 + i, resetsAt: WEEK_RESET } });
  const r = learnRate(rows, () => 37, "seven"); // cada 1 pp custou US$ 37
  assert.equal(r.pairs, 8);
  assert.equal(Math.round(r.usdPerPct!), 37);
  assert.equal(learnRate(rows.slice(0, 5), () => 37, "seven").usdPerPct, null);
  assert.equal(learnRate(rows.map((x) => ({ ...x, session: null })), () => 37, "seven").pairs, 0);
});

test("percentis dos presets", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.25), 20);
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 48);
});

// Derivados da camada 0: tudo calculado aqui, de forma determinística.
import { existsSync, readFileSync, statSync } from "node:fs";
import { P, loadConfig, readJson, readJsonl, type ModelsCatalog } from "./store.ts";
import { records, prices, type UsageRecord } from "./series.ts";
import { listFlags, raiseFlag, clearFlag } from "./flags.ts";
import { meta, activeClaudeAccount } from "./collector/claude.ts";
import { soulPools, soulVocabulary } from "./collector/soul.ts";
import { readClaudeSettings } from "./control.ts";
import { buildCabe, checkEstimates, fiveHourWindows } from "./cabe.ts";
import type { Cabe } from "../shared/cabe.ts";
import { peekOfficialUsage } from "./oauth-usage.ts";
import { FRESH_MS, officialReading, pickLatest } from "./official-reading.ts";
import { computeVerdict, humanTime, otherAccounts, sameReset, whenFull, type FableManual, type Reading } from "./verdict.ts";
import type { Verdict, Autonomy, Bucket, Limits, LimitWindow, Named, PulseRecord, Snapshot, Suggestion } from "../shared/snapshot.ts";

const H = 3600_000;
const D = 24 * H;

function empty(): Bucket {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, total: 0, cost: 0, n: 0 };
}
function add(b: Bucket, r: UsageRecord) {
  b.input += r.input;
  b.output += r.output;
  b.cacheWrite += r.cacheWrite;
  b.cacheRead += r.cacheRead;
  b.thinking += r.thinking;
  b.total += r.input + r.output + r.cacheWrite + r.cacheRead;
  b.cost += r.cost ?? 0;
  b.n += 1;
}
function group(rs: UsageRecord[], key: (r: UsageRecord) => string, top = 12): Named[] {
  const m = new Map<string, Bucket>();
  for (const r of rs) {
    const k = key(r);
    let b = m.get(k);
    if (!b) m.set(k, (b = empty()));
    add(b, r);
  }
  return [...m].map(([key, b]) => ({ key, ...b })).sort((a, b) => b.cost - a.cost || b.total - a.total).slice(0, top);
}
function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
const hhmm = (iso: string | number) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const family = (model: string) => (/opus/.test(model) ? "opus" : /sonnet/.test(model) ? "sonnet" : /haiku/.test(model) ? "haiku" : /fable|mythos/.test(model) ? "fable" : model);

/** Primeiro índice com ts >= t (records está ordenado). */
function since(t: number): UsageRecord[] {
  let lo = 0, hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid].ts < t) lo = mid + 1;
    else hi = mid;
  }
  return records.slice(lo);
}

// ------------------------------------------------------------ limites

type StatuslineSnap = { at: string; version?: string; model?: string; keys: string[]; rateLimits: any };

function windowOf(x: any): LimitWindow | undefined {
  if (!x || typeof x !== "object") return undefined;
  const pct = Number(x.used_percentage ?? x.usedPercentage ?? x.utilization);
  if (!Number.isFinite(pct)) return undefined;
  const r = x.resets_at ?? x.resetsAt ?? null;
  const resetsAt = r == null ? null : typeof r === "number" ? new Date(r < 1e12 ? r * 1000 : r).toISOString() : String(r);
  return { usedPct: pct, resetsAt };
}

/**
 * Limites do plano. Fonte primária: leitura oficial (/api/oauth/usage) fresca (< 15 min);
 * reserva: a statusline do Claude Code. `source` diz de qual dos dois veio o que está na tela.
 */
export function readLimits(now = Date.now()): Limits {
  const peek = peekOfficialUsage();
  const off = officialReading(peek);
  if (off && now - Date.parse(off.at) < FRESH_MS) return { state: "ok", source: "official", at: off.at, fiveHour: off.five, sevenDay: off.seven };
  // sem oficial fresca: a razão entra nas mensagens da reserva, para não parecer que só a statusline falhou
  const offWhy = peek?.state === "unavailable" ? ` Leitura oficial indisponível agora (${peek.reason ?? "sem motivo informado"}).` : "";
  if (!existsSync(P.statusline)) return { state: "missing", reason: `Limites indisponíveis — ative a statusline do monitor no Claude Code (veja o README).${offWhy}` };
  const s = readJson<StatuslineSnap>(P.statusline, { at: "", keys: [], rateLimits: null });
  const fiveHour = windowOf(s.rateLimits?.five_hour);
  const sevenDay = windowOf(s.rateLimits?.seven_day);
  if (!fiveHour && !sevenDay) {
    raiseFlag({ key: "statusline-no-limits", kind: "fonte-incompleta", level: "warning", title: "A linha de status chega, mas sem os limites do plano", detail: `O Claude Code não enviou o % da sessão de 5 h nem da semana nesta versão ou conta (${s.keys.length} campos recebidos). Sem eles, o veredito fica só na tendência.` });
    return { state: "missing", reason: `A statusline está ativa, mas o Claude Code não enviou os limites de 5 h/semana nesta versão ou conta.${offWhy}` };
  }
  clearFlag("statusline-no-limits");
  if (!(now - Date.parse(s.at) <= FRESH_MS)) {
    // reserva velha: se houver leitura oficial mais nova que ela (mesmo fora da janela de frescor), é essa que se mostra
    if (off && Date.parse(off.at) > (Date.parse(s.at) || 0)) return { state: "stale", source: "official", reason: `Última leitura oficial dos limites em ${whenFull(off.at, now)}.`, at: off.at, fiveHour: off.five, sevenDay: off.seven };
    return { state: "stale", source: "statusline", reason: `Último dado de limite em ${whenFull(s.at, now)} — a statusline só atualiza enquanto o Claude Code está aberto.${offWhy}`, at: s.at, fiveHour, sevenDay };
  }
  return { state: "ok", source: "statusline", at: s.at, fiveHour, sevenDay, model: s.model, version: s.version };
}

function autonomy(limits: Limits, recent: UsageRecord[], now: number): Autonomy {
  if (limits.state !== "missing" && limits.fiveHour) {
    const w = limits.fiveHour;
    const hist = readJsonl<{ at: string; five?: LimitWindow }>(P.statuslineHistory).filter(
      (h) => h.five && h.five.resetsAt === w.resetsAt && now - Date.parse(h.at) < 90 * 60_000,
    );
    let rate = 0;
    if (hist.length >= 2) {
      const a = hist[0], b = hist[hist.length - 1];
      const dh = (Date.parse(b.at) - Date.parse(a.at)) / H;
      if (dh > 0.05) rate = (b.five!.usedPct - a.five!.usedPct) / dh;
    }
    const resetsAt = w.resetsAt;
    let hitsAt: string | null = null;
    let verdict: string;
    if (w.usedPct >= 100) verdict = `Limite de 5 h atingido${resetsAt ? `; volta às ${hhmm(resetsAt)}` : ""}.`;
    else if (rate <= 0) verdict = hist.length < 2 ? `Em ${w.usedPct.toFixed(0)}% da janela de 5 h; ritmo ainda sem pontos suficientes para projetar.` : `Em ${w.usedPct.toFixed(0)}% da janela de 5 h; ritmo parado.`;
    else {
      const hitMs = now + ((100 - w.usedPct) / rate) * H;
      hitsAt = new Date(hitMs).toISOString();
      if (resetsAt && hitMs > Date.parse(resetsAt)) verdict = `No ritmo atual chega ao reset (${hhmm(resetsAt)}) com folga — projeção ${Math.min(100, w.usedPct + rate * ((Date.parse(resetsAt) - now) / H)).toFixed(0)}%.`;
      else verdict = `No ritmo atual bate o limite de 5 h às ${hhmm(hitMs)}${resetsAt ? `, antes do reset (${hhmm(resetsAt)})` : ""}.`;
    }
    return { basis: "limits", window: "5h", usedPct: w.usedPct, ratePctPerHour: rate, hitsAt, resetsAt, verdict };
  }
  const cc = recent.filter((r) => r.source === "claude-code");
  const lastHour = cc.filter((r) => r.ts >= now - H).reduce((s, r) => s + r.input + r.output + r.cacheWrite, 0);
  const day = cc.filter((r) => r.ts >= now - 7 * D);
  const activeHours = new Set(day.map((r) => Math.floor(r.ts / H))).size || 1;
  const avg = day.reduce((s, r) => s + r.input + r.output + r.cacheWrite, 0) / activeHours;
  const ratio = avg ? lastHour / avg : 0;
  return {
    basis: "trend",
    tokensPerHourNow: lastHour,
    tokensPerHourAvg: avg,
    verdict: avg === 0 ? "Sem consumo na última semana." : ratio > 1.5 ? `Ritmo da última hora ${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× acima da sua média por hora ativa.` : ratio < 0.5 ? "Ritmo da última hora abaixo da sua média." : "Ritmo da última hora dentro da sua média.",
    reason: "Sem a janela de 5 h entre os limites lidos não há como dizer quando ela bate o teto — só a tendência de tokens (sem cache lido).",
  };
}

// ------------------------------------------------------------ veredito (plano §3)

function toWin(x: any) {
  return windowOf(x);
}
export function readFableManual(): FableManual | null {
  return readJson<FableManual | null>(P.fableManual, null);
}
export function readHistory(now: number): Reading[] {
  return readJsonl<Reading>(P.statuslineHistory).filter((h) => now - Date.parse(h.at) <= 8 * D);
}
export function buildVerdict(now: number, lastUsageAt: number | null, history: Reading[] = readHistory(now)): Verdict {
  let statusline: Reading | null = null;
  if (existsSync(P.statusline)) {
    const s = readJson<StatuslineSnap & { session?: string }>(P.statusline, { at: "", keys: [], rateLimits: null });
    if (s.at) statusline = { at: s.at, session: s.session ?? null, source: "statusline", five: toWin(s.rateLimits?.five_hour), seven: toWin(s.rateLimits?.seven_day) };
  }
  // uso oficial (/api/oauth/usage): fonte primária quando fresco; a statusline é a reserva
  const off = peekOfficialUsage();
  const latest = pickLatest(statusline, officialReading(off), now);
  const weekStart = latest?.seven?.resetsAt ? Date.parse(latest.seven.resetsAt) - 7 * D : now - 7 * D;
  const fable = since(weekStart).filter((r) => r.source === "claude-code" && family(r.model) === "fable");
  const fableUsage = fable.length ? { tokens: fable.reduce((x, r) => x + r.input + r.output + r.cacheWrite + r.cacheRead, 0), cost: fable.reduce((x, r) => x + (r.cost ?? 0), 0), since: new Date(weekStart).toISOString() } : null;
  const acc = otherAccounts(latest ? [...history, latest] : history, now);
  if (acc) {
    const pct = (r: Reading) => (r.seven ? `semana em ${Math.round(r.seven.usedPct)} %, renova ${humanTime(r.seven.resetsAt ?? r.at, now, "reset")}` : `sessão de 5 h em ${Math.round(r.five!.usedPct)} %`);
    raiseFlag({ key: "outra-conta", kind: "dado-divergente", level: "warning", title: "Outra conta do Claude aberta — o veredito segue a mais recente", detail: `Há sessões do Claude Code com limites de renovação diferentes, então são contas diferentes. Conta mais recente: ${pct(acc.active)}. Outra: ${pct(acc.other)}. O veredito segue a conta mais recente.` });
  } else clearFlag("outra-conta");
  clearFlag("sessoes-divergentes"); // aviso antigo: divergência entre sessões da mesma conta era atraso, não outra conta
  return computeVerdict({ now, latest, history, fableManual: readFableManual(), fableOfficial: off?.state === "ok" && off.fable ? { pct: off.fable.usedPct, resetsAt: off.fable.resetsAt, at: off.at } : null, fableUsage, lastUsageAt });
}

// ------------------------------------------------------------ semana (plano G5)

function buildSemana(v: Verdict, history: Reading[], cc28: UsageRecord[], cabe: Cabe, now: number): Snapshot["semana"] {
  const w7 = v.windows.find((w) => w.id === "7d");
  const resetsAt = w7?.resetsAt ?? null;
  const weekStart = resetsAt ? Date.parse(resetsAt) - 7 * D : null;
  // série oficial da semana: mesma renovação; sessão atual (ou leituras antigas sem sessão); por hora; nunca desce
  const byHour = new Map<number, number>();
  for (const h of history) {
    // mesma conta (mesma renovação), todas as sessões; o máximo da hora descarta sessão ociosa atrasada
    if (!h.seven || !sameReset(h.seven.resetsAt, resetsAt)) continue;
    const k = Math.floor(Date.parse(h.at) / H) * H;
    byHour.set(k, Math.max(byHour.get(k) ?? 0, h.seven.usedPct));
  }
  let run = 0;
  const points = [...byHour].sort((a, b) => a[0] - b[0]).map(([t, pct]) => ({ t: new Date(t).toISOString(), pct: (run = Math.max(run, pct)) }));
  if (weekStart != null && (!points.length || Date.parse(points[0].t) > weekStart)) points.unshift({ t: new Date(weekStart).toISOString(), pct: 0 });
  const used = w7?.usedPct ?? null;
  const daysLeft = resetsAt ? (Date.parse(resetsAt) - now) / D : null;
  const needPerDay = used != null && daysLeft && daysLeft > 0 ? (100 - used) / daysLeft : null;
  const day0 = startOfDay(now);
  // "hoje" só com uma leitura oficial real antes da meia-noite (o 0 % do início da semana não conta, salvo se a semana começou hoje)
  const before = [...points].reverse().find((p) => Date.parse(p.t) <= day0 && (byHour.has(Date.parse(p.t)) || Date.parse(p.t) === weekStart));
  const atDayStart = before && (byHour.has(Date.parse(before.t)) || (weekStart != null && weekStart >= day0)) ? before.pct : weekStart != null && weekStart >= day0 ? 0 : null;
  const todayPct = used != null && atDayStart != null ? used - atDayStart : null;
  const own = cc28.filter((r) => !r.platform);
  const wk = weekStart != null ? own.filter((r) => r.ts >= weekStart) : [];
  const cost = wk.reduce((x, r) => x + (r.cost ?? 0), 0);
  const lastWeek = weekStart != null && own.length && own[0].ts <= weekStart - 7 * D ? own.filter((r) => r.ts >= weekStart - 7 * D && r.ts < weekStart).reduce((x, r) => x + (r.cost ?? 0), 0) : null;
  const share = (rows: Named[]) => rows.map((n) => ({ key: n.key, cost: n.cost, share: cost ? n.cost / cost : 0 }));
  const side = wk.filter((r) => r.side).reduce((x, r) => x + (r.cost ?? 0), 0);
  const slackBelow = !cabe.enoughHistory ? null : cabe.presets.find((p) => p.id === "leve")?.usd ?? null;
  const wins = weekStart != null ? fiveHourWindows(wk).map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(), cost: w.cost, active: now < w.end, slack: slackBelow != null && now >= w.end && w.cost < slackBelow })) : [];
  return {
    weekStart: weekStart != null ? new Date(weekStart).toISOString() : null,
    resetsAt,
    points,
    usedPct: used,
    needPerDay,
    todayPct,
    cost,
    lastWeekCost: lastWeek,
    byFamily: share(group(wk, (r) => family(r.model), 6)),
    sideShare: cost ? side / cost : 0,
    byProject: share(group(wk, (r) => r.project, 10)),
    windows: wins,
    slackBelow,
  };
}

// ------------------------------------------------------------ janelas de 5 h

function windows(cc: UsageRecord[], now: number) {
  const out: { start: string; end: string; cost: number; total: number; active: boolean }[] = [];
  let cur: { s: number; cost: number; total: number } | null = null;
  for (const r of cc) {
    if (!cur || r.ts >= cur.s + 5 * H) {
      if (cur) out.push({ start: new Date(cur.s).toISOString(), end: new Date(cur.s + 5 * H).toISOString(), cost: cur.cost, total: cur.total, active: false });
      // janela começa na hora cheia da primeira mensagem (como o plano conta)
      const s = Math.floor(r.ts / H) * H;
      cur = { s, cost: 0, total: 0 };
    }
    cur.cost += r.cost ?? 0;
    cur.total += r.input + r.output + r.cacheWrite + r.cacheRead;
  }
  if (cur) out.push({ start: new Date(cur.s).toISOString(), end: new Date(cur.s + 5 * H).toISOString(), cost: cur.cost, total: cur.total, active: now < cur.s + 5 * H });
  return out.slice(-20);
}

// ------------------------------------------------------------ snapshot

let lastPulse: PulseRecord | null = null;
let pulseState = { running: false, nextAt: null as string | null };
export function setPulseState(p: { running?: boolean; nextAt?: string | null; last?: PulseRecord }) {
  if (p.running !== undefined) pulseState.running = p.running;
  if (p.nextAt !== undefined) pulseState.nextAt = p.nextAt;
  if (p.last) lastPulse = p.last;
}
export function getLastPulse(): PulseRecord | null {
  if (!lastPulse) lastPulse = readJsonl<PulseRecord>(P.pulses).at(-1) ?? null;
  return lastPulse;
}

export function buildSnapshot(): Snapshot {
  const now = Date.now();
  const cfg = loadConfig();
  const r28 = since(now - 28 * D);
  const r7 = r28.filter((r) => r.ts >= now - 7 * D);
  const today0 = startOfDay(now);
  const rToday = r7.filter((r) => r.ts >= today0);

  const today = empty();
  rToday.forEach((r) => add(today, r));
  const week = empty();
  r7.forEach((r) => add(week, r));

  const hourly: Snapshot["hourly"] = [];
  const h0 = Math.floor(now / H) * H - 47 * H;
  for (let i = 0; i < 48; i++) hourly.push({ hour: new Date(h0 + i * H).toISOString(), cost: 0, total: 0, byModel: {} });
  for (const r of r7) {
    if (r.ts < h0) continue;
    const i = Math.floor((r.ts - h0) / H);
    const h = hourly[i];
    if (!h) continue;
    h.cost += r.cost ?? 0;
    h.total += r.input + r.output + r.cacheWrite + r.cacheRead;
    const f = family(r.model);
    h.byModel[f] = (h.byModel[f] ?? 0) + (r.cost ?? 0);
  }
  const daily: Snapshot["daily"] = [];
  const r30 = since(startOfDay(now) - 29 * D);
  for (let i = 29; i >= 0; i--) {
    const s = startOfDay(now) - i * D;
    daily.push({ day: new Date(s).toISOString(), cost: 0, total: 0 });
  }
  for (const r of r30) {
    const i = Math.round((startOfDay(r.ts) - (startOfDay(now) - 29 * D)) / D);
    if (daily[i]) {
      daily[i].cost += r.cost ?? 0;
      daily[i].total += r.input + r.output + r.cacheWrite + r.cacheRead;
    }
  }

  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const r of r28) {
    const d = new Date(r.ts);
    heat[d.getDay()][d.getHours()] += (r.cost ?? 0) / 4; // média por semana
  }

  const side = rToday.filter((r) => r.side);
  const sideCost = side.reduce((s, r) => s + (r.cost ?? 0), 0);
  const sideOpus = side.filter((r) => family(r.model) === "opus").reduce((s, r) => s + (r.cost ?? 0), 0);
  const platformToday = rToday.filter((r) => r.platform);
  // gasto da plataforma: o que o coletor viu nos jsonl (cwd = agent-work) ou,
  // se maior, o total_cost_usd que o próprio claude -p devolveu (ainda não coletado)
  const loggedSpend = readJsonl<{ at: string; costUSD: number | null }>(P.platformSpend).filter((x) => Date.parse(x.at) >= today0);
  const platformCost = Math.max(platformToday.reduce((s, r) => s + (r.cost ?? 0), 0), loggedSpend.reduce((s, x) => s + (x.costUSD ?? 0), 0));

  const ccAll = since(now - 4 * D).filter((r) => r.source === "claude-code");
  const wins = windows(ccAll, now);
  const limits = readLimits();
  const auto = autonomy(limits, r7, now);
  const lastCC = [...r7].reverse().find((r) => r.source === "claude-code" && !r.platform);
  const history = readHistory(now);
  const verdict = buildVerdict(now, lastCC?.ts ?? null, history);
  const cc28 = r28.filter((r) => r.source === "claude-code");
  const cabe = buildCabe(cc28, history, now);
  checkEstimates(cc28, history, now);
  const semana = buildSemana(verdict, history, cc28, cabe, now);

  rateJumpRule(r7, now);

  const catalog = readJson<ModelsCatalog>(P.models, { claude: { models: [], efforts: [] } });
  const seenModels = [...new Set(r28.filter((r) => r.source === "claude-code").map((r) => r.model))];
  const settings = (() => {
    try {
      const s = readClaudeSettings();
      return { model: (s.model as string) ?? null, effortLevel: (s.effortLevel as string) ?? null };
    } catch (e) {
      return { model: null, effortLevel: null, error: (e as Error).message };
    }
  })();

  const byModel = group(rToday, (r) => r.model);
  const snap: Snapshot = {
    at: new Date(now).toISOString(),
    collector: { lastCycleMs: meta.lastCycleMs, filesScanned: meta.filesScanned, records: records.length, backfillDone: meta.backfillDone, intervalSec: cfg.collectIntervalSec, claudeVersion: meta.lastVersion, priceTable: prices().version, priceSource: prices().source },
    account: activeClaudeAccount(),
    settings,
    catalog: { models: [...new Set([...catalog.claude.models, ...seenModels])], efforts: catalog.claude.efforts, soulModels: soulVocabulary.models, soulEfforts: soulVocabulary.efforts },
    today,
    week,
    bySource: group(r7, (r) => r.source),
    hourly,
    daily,
    byModel,
    byModelWeek: group(r7, (r) => r.model),
    byProject: group(r7, (r) => r.project, 10),
    byProjectToday: group(rToday.filter((r) => r.source === "claude-code"), (r) => r.project, 10),
    byAccount: group(r7, (r) => `${r.source === "soul" ? "Soul" : "Claude Code"} · ${r.account}`, 10),
    sidechainToday: { cost: sideCost, share: today.cost ? sideCost / today.cost : 0, opusShare: today.cost ? sideOpus / today.cost : 0 },
    heatmap: heat,
    windows: wins,
    limits,
    autonomy: auto,
    verdict,
    cabe,
    semana,
    tempDefault: readJson<Snapshot["tempDefault"]>(P.tempDefault, null),
    platform: { todayCost: platformCost, budget: cfg.platformDailyBudgetUSD, calls: Math.max(new Set(platformToday.map((r) => r.session)).size, loggedSpend.length) },
    flags: listFlags(),
    suggestions: [],
    soul: soulPools(),
    pulse: { enabled: cfg.pulse.enabled, model: cfg.pulse.model, lastAt: getLastPulse()?.at ?? null, nextAt: pulseState.nextAt, running: pulseState.running, last: getLastPulse() },
  };
  snap.suggestions = suggestions(snap, rToday, wins);
  return snap;
}

function rateJumpRule(r7: UsageRecord[], now: number) {
  const byHour = new Map<number, number>();
  for (const r of r7) byHour.set(Math.floor(r.ts / H), (byHour.get(Math.floor(r.ts / H)) ?? 0) + (r.cost ?? 0));
  const cur = byHour.get(Math.floor(now / H)) ?? 0;
  const past = [...byHour].filter(([h, c]) => h < Math.floor(now / H) && c > 0).map(([, c]) => c).sort((a, b) => a - b);
  if (past.length < 6) return;
  const median = past[Math.floor(past.length / 2)];
  if (cur > 3 * median && cur > 2) {
    raiseFlag({ key: `rate-jump:${Math.floor(now / H)}`, kind: "salto-de-ritmo", level: "alert", title: "Salto de ritmo nesta hora", detail: `US$ ${cur.toFixed(2)} nesta hora contra mediana de US$ ${median.toFixed(2)} por hora ativa (7 dias).` });
  }
}

const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function suggestions(s: Snapshot, rToday: UsageRecord[], wins: Snapshot["windows"]): Suggestion[] {
  const out: Suggestion[] = [];
  const at = s.at;
  if (s.today.cost > 1 && s.sidechainToday.opusShare >= 0.3) {
    out.push({ id: "opus-subagents", origin: "regra", level: "alert", title: `${Math.round(s.sidechainToday.opusShare * 100)}% do custo de hoje foi opus em subagentes`, detail: "Subagentes de leitura e varredura rendem igual em sonnet ou haiku. Defina o modelo no brief de cada agente.", at });
  }
  const opus = s.byModel.filter((m) => family(m.key) === "opus").reduce((x, m) => x + m.cost, 0);
  if (s.today.cost > 1 && opus / s.today.cost > 0.8) {
    out.push({ id: "opus-heavy", origin: "regra", level: "warning", title: `${Math.round((opus / s.today.cost) * 100)}% do custo de hoje em opus`, detail: "Se a janela apertar, trocar o modelo padrão para sonnet devolve fôlego; opus fica para o que pede raciocínio.", at });
  }
  const act = wins.find((w) => w.active);
  const resets = s.limits.state !== "missing" ? s.limits.fiveHour?.resetsAt : null;
  if (resets) out.push({ id: "window-reset", origin: "regra", level: "info", title: `A janela de 5 h reseta às ${hhmm(resets)}`, detail: `Uso atual: ${s.limits.state !== "missing" ? s.limits.fiveHour?.usedPct.toFixed(0) : "?"}%.`, at });
  else if (act) out.push({ id: "window-reset-est", origin: "regra", level: "info", title: `Janela estimada termina às ${hhmm(act.end)}`, detail: "Estimativa pelo horário da primeira mensagem (a leitura dos limites não trouxe o horário oficial desta janela).", at });
  if (s.limits.state !== "missing" && s.limits.sevenDay && s.limits.sevenDay.usedPct >= 70) {
    out.push({ id: "week-high", origin: "regra", level: "alert", title: `Semana em ${s.limits.sevenDay.usedPct.toFixed(0)}%`, detail: `Reseta ${s.limits.sevenDay.resetsAt ? new Date(s.limits.sevenDay.resetsAt).toLocaleString("pt-BR", { weekday: "long", hour: "2-digit", minute: "2-digit" }) : "em data não informada"}. Priorize sonnet/haiku até lá.`, at });
  }
  const cacheIn = s.today.cacheRead + s.today.cacheWrite + s.today.input;
  if (cacheIn > 1e6 && s.today.cacheRead / cacheIn < 0.6) {
    out.push({ id: "cache-low", origin: "regra", level: "warning", title: `Só ${Math.round((s.today.cacheRead / cacheIn) * 100)}% da entrada de hoje veio do cache`, detail: "Sessões curtas e retomadas frequentes reescrevem o cache. Sessões mais longas no mesmo assunto ficam mais baratas.", at });
  }
  if (s.platform.todayCost >= s.platform.budget * 0.8) {
    out.push({ id: "platform-budget", origin: "regra", level: "alert", title: `A plataforma já gastou ${usd(s.platform.todayCost)} hoje`, detail: `Teto diário: ${usd(s.platform.budget)}. Ao atingir, pulso e chat param até amanhã.`, at });
  }
  // pico do heatmap
  let best = { d: 0, h: 0, v: 0 };
  s.heatmap.forEach((row, d) => row.forEach((v, h) => v > best.v && (best = { d, h, v })));
  if (best.v > 0) {
    const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    out.push({ id: "peak", origin: "regra", level: "info", title: `Seu pico é ${dias[best.d]} às ${best.h}h`, detail: `Média de ${usd(best.v)} nessa hora nas últimas 4 semanas.`, at });
  }
  const pulse = s.pulse.last;
  if (pulse && !pulse.error) pulse.findings.slice(0, 4).forEach((f, i) => out.push({ id: `pulse-${i}`, origin: "pulso", level: pulse.ok ? "notice" : "alert", title: f, detail: `Pulso ${pulse.model} às ${hhmm(pulse.at)}${pulse.escalate !== "none" ? ` · pediu escalada para ${pulse.escalate}` : ""}.`, at: pulse.at }));
  void rToday;
  return out;
}

export function statuslineMtime(): number {
  try {
    return statSync(P.statusline).mtimeMs;
  } catch {
    return 0;
  }
}
void readFileSync;

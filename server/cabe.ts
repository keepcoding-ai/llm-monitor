// "Cabe?" no servidor: presets vindos do próprio histórico (percentis do custo
// das janelas de 5 h em 4 semanas), conversão % ↔ US$ aprendida das leituras
// oficiais e o fechamento do ciclo (estimativa registrada vs o que aconteceu).
import { P, appendJsonl, readJsonl } from "./store.ts";
import { raiseFlag } from "./flags.ts";
import type { UsageRecord } from "./series.ts";
import type { Reading } from "./verdict.ts";
import type { Cabe, CabePreset } from "../shared/cabe.ts";

const H = 3600_000;
const D = 24 * H;

/** Janelas de 5 h (começam na hora cheia da primeira mensagem, como o plano conta). */
export function fiveHourWindows(cc: UsageRecord[]): { start: number; end: number; cost: number }[] {
  const out: { start: number; end: number; cost: number }[] = [];
  let cur: { start: number; end: number; cost: number } | null = null;
  for (const r of cc) {
    if (!cur || r.ts >= cur.end) {
      if (cur) out.push(cur);
      const s = Math.floor(r.ts / H) * H;
      cur = { start: s, end: s + 5 * H, cost: 0 };
    }
    cur.cost += r.cost ?? 0;
  }
  if (cur) out.push(cur);
  return out;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Custo acumulado (prefix sum) para somar US$ de qualquer intervalo em O(log n). */
function costIndex(cc: UsageRecord[]) {
  const ts = cc.map((r) => r.ts);
  const acc: number[] = [];
  let s = 0;
  for (const r of cc) acc.push((s += r.cost ?? 0));
  const idx = (t: number) => {
    let lo = 0, hi = ts.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo; // registros com ts <= t
  };
  return (a: number, b: number) => {
    const i = idx(a), j = idx(b);
    return (j ? acc[j - 1] : 0) - (i ? acc[i - 1] : 0);
  };
}

/** Pares (Δ% oficial, Δ US$) entre mudanças de % na mesma sessão e mesma janela. Regressão pela origem. */
export function learnRate(history: Reading[], costBetween: (a: number, b: number) => number, key: "five" | "seven"): { usdPerPct: number | null; pairs: number } {
  const bySeq = new Map<string, { t: number; v: number }[]>();
  for (const h of history) {
    const w = h[key];
    // sem sessão (leituras antigas) não há como separar duas contas abertas: fica de fora
    if (!w || !h.session) continue;
    const k = `${h.session}|${w.resetsAt}`;
    const arr = bySeq.get(k) ?? [];
    const t = Date.parse(h.at);
    const last = arr[arr.length - 1];
    if (!last || w.usedPct !== last.v) arr.push({ t, v: w.usedPct });
    bySeq.set(k, arr);
  }
  let sxy = 0, sxx = 0, n = 0;
  for (const pts of bySeq.values()) {
    for (let i = 1; i < pts.length; i++) {
      const dp = pts[i].v - pts[i - 1].v;
      if (dp <= 0 || dp > 5 || pts[i].t - pts[i - 1].t > 6 * H) continue;
      const du = costBetween(pts[i - 1].t, pts[i].t);
      sxy += dp * du;
      sxx += dp * dp;
      n++;
    }
  }
  return { usdPerPct: n >= 6 && sxx > 0 ? sxy / sxx : null, pairs: n };
}

// presets só do histórico real: sem janelas suficientes, não há preset (nada inventado)
const WINDOWS_NEEDED = 8;

export function buildCabe(cc28: UsageRecord[], history: Reading[], now: number): Cabe {
  const own = cc28.filter((r) => !r.platform);
  const wins = fiveHourWindows(own).filter((w) => w.end <= now && w.cost > 0);
  const costs = wins.map((w) => w.cost).sort((a, b) => a - b);
  const enoughHistory = own.length > 0 && own[0].ts <= now - 21 * D && costs.length >= WINDOWS_NEEDED;
  const fableHours = new Map<number, number>();
  for (const r of own) if (/fable|mythos/.test(r.model)) fableHours.set(Math.floor(r.ts / H), (fableHours.get(Math.floor(r.ts / H)) ?? 0) + (r.cost ?? 0));
  const fableHour = fableHours.size ? [...fableHours.values()].reduce((s, x) => s + x, 0) / fableHours.size : null;
  const presets: CabePreset[] = !enoughHistory
    ? []
    : [
        { id: "leve", label: "sessão leve", usd: percentile(costs, 0.25), basis: `p25 de ${costs.length} janelas de 5 h` },
        { id: "pesada", label: "sessão pesada", usd: percentile(costs, 0.75), basis: `p75 de ${costs.length} janelas de 5 h` },
        { id: "agentes", label: "time de agentes", usd: percentile(costs, 0.95), basis: `p95 de ${costs.length} janelas de 5 h` },
      ];
  if (fableHour != null) presets.push({ id: "fable", label: "Fable 1 h", usd: fableHour, basis: `média de ${fableHours.size} horas com Fable` });
  const between = costIndex(own.filter((r) => r.ts >= now - 8 * D));
  const wk = learnRate(history, between, "seven");
  const fh = learnRate(history, between, "five");
  return { presets, enoughHistory, windowsClosed: costs.length, windowsNeeded: WINDOWS_NEEDED, historySince: own.length ? new Date(own[0].ts).toISOString() : null, usdPerPctWeek: wk.usdPerPct, usdPerPct5h: fh.usdPerPct, pairsWeek: wk.pairs, pairs5h: fh.pairs };
}

// ------------------------------------------------------------ previsão vs real (fecha o ciclo de G6)

export type CabeEstimate = { at: string; preset: string; usd: number; usdPerPctWeek: number | null; session: string | null; weekResetsAt: string | null };
type CabeCheck = { at: string; estimateAt: string; predictedPct: number; actualPct: number; errorPct: number };

/** Depois de uma janela de 5 h, compara a conversão usada na estimativa com o que as leituras oficiais mostraram. */
export function checkEstimates(cc: UsageRecord[], history: Reading[], now: number) {
  const ests = readJsonl<CabeEstimate>(P.cabeEstimates);
  if (!ests.length) return;
  const done = new Set(readJsonl<CabeCheck>(P.cabeChecks).map((c) => c.estimateAt));
  const between = costIndex(cc.filter((r) => !r.platform));
  for (const e of ests) {
    const t0 = Date.parse(e.at);
    const t1 = t0 + 5 * H;
    if (done.has(e.at) || now < t1 || !e.usdPerPctWeek) continue;
    const near = (t: number) => history.filter((h) => h.seven && h.seven.resetsAt === e.weekResetsAt && (!e.session || h.session === e.session)).reduce<Reading | null>((best, h) => (!best || Math.abs(Date.parse(h.at) - t) < Math.abs(Date.parse(best.at) - t) ? h : best), null);
    const a = near(t0);
    const b = near(t1);
    const spent = between(t0, t1);
    if (!a || !b || Math.abs(Date.parse(a.at) - t0) > 30 * 60_000 || Math.abs(Date.parse(b.at) - t1) > 30 * 60_000) {
      appendJsonl(P.cabeChecks, [{ at: new Date(now).toISOString(), estimateAt: e.at, predictedPct: NaN, actualPct: NaN, errorPct: NaN }]);
      continue; // sem leitura oficial nas pontas: não dá para medir (registrado para não reavaliar)
    }
    const actualPct = b.seven!.usedPct - a.seven!.usedPct;
    const predictedPct = spent / e.usdPerPctWeek;
    const errorPct = actualPct > 0 ? Math.abs(predictedPct - actualPct) / actualPct : predictedPct > 0.5 ? 1 : 0;
    appendJsonl(P.cabeChecks, [{ at: new Date(now).toISOString(), estimateAt: e.at, predictedPct, actualPct, errorPct }]);
    if (errorPct > 0.3 && Math.max(actualPct, predictedPct) >= 1)
      raiseFlag({ key: `cabe-errou:${e.at}`, kind: "cabe-errou", level: "warning", title: "Cabe? errou mais de 30 %", detail: `Nas 5 h depois da estimativa de ${e.preset}, o gasto (US$ ${spent.toFixed(0)}) daria ${predictedPct.toFixed(1)} % da semana pela conversão aprendida; as leituras oficiais mostraram ${actualPct.toFixed(1)} %. A conversão se corrige sozinha com novas leituras.` });
  }
}

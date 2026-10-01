// Veredito honesto multi-janela (plano-interface §3). Funções puras: entram
// leituras da linha de status do Claude Code e o relógio; sai a frase, o estado e
// a projeção de cada janela. Nada aqui lê disco — quem lê é buildVerdictFromDisk.
import type { Verdict, VerdictState, VerdictWindow } from "../shared/snapshot.ts";

const H = 3600_000;
const D = 24 * H;

export type Reading = { at: string; session?: string | null; five?: { usedPct: number; resetsAt: string | null }; seven?: { usedPct: number; resetsAt: string | null } };
export type FableManual = { pct: number; at: string; resetsAt: string | null };
export type FableUsage = { tokens: number; cost: number; since: string } | null;

// ------------------------------------------------------------ hora humana

const WD_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const WD_PROJ = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const WD_ABBR = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTH = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function dayDiff(t: number, now: number) {
  const a = new Date(now);
  a.setHours(0, 0, 0, 0);
  const b = new Date(t);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / D);
}
function period(h: number) {
  return h < 6 ? "de madrugada" : h < 12 ? "de manhã" : h < 18 ? "à tarde" : "à noite";
}

/** Projeção é imprecisa: nunca minuto. Período do dia; faltando < 2 h, duração aproximada. */
function projTime(t: number, now: number, dd: number): string {
  const d = new Date(t);
  const min = Math.round((t - now) / 60000);
  if (min >= 0 && min < 120) return min < 60 ? `em cerca de ${Math.max(1, min)} min` : "em cerca de 1 h";
  const per = period(d.getHours());
  if (dd === 0) return `hoje ${per}`;
  if (dd === 1) return `amanhã ${per}`;
  if (dd > 1 && dd < 7) return `${WD_PROJ[d.getDay()]} ${per}`;
  return `${d.getDate()} de ${MONTH[d.getMonth()]}`;
}

/** Uma função para toda hora na tela. Projeção é imprecisa → período; reset é exato → hora. */
export function humanTime(iso: string | number, now: number, kind: "proj" | "reset"): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const d = new Date(t);
  const dd = dayDiff(t, now);
  if (kind === "proj") return projTime(t, now, dd);
  if (dd === 0) return `hoje às ${hm(d)}`;
  if (dd === -1) return `ontem às ${hm(d)}`;
  if (dd < -1 && dd > -7) return `${WD_LONG[d.getDay()]}, ${hm(d)}`;
  if (dd === 1) return `amanhã às ${hm(d)}`;
  if (dd > 0 && dd < 7) return `${WD_LONG[d.getDay()]}, ${hm(d)}`;
  return `${d.getDate()} de ${MONTH[d.getMonth()]}`;
}

/** Forma curta para a linha de status (≤ 40 caracteres no total). */
export function shortProj(iso: string | number, now: number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const min = Math.round((t - now) / 60000);
  if (min >= 0 && min < 120) return min < 60 ? `em ${Math.max(1, min)} min` : "em ~1 h";
  const dd = dayDiff(t, now);
  const p = ["madrugada", "manhã", "tarde", "noite"][new Date(t).getHours() < 6 ? 0 : new Date(t).getHours() < 12 ? 1 : new Date(t).getHours() < 18 ? 2 : 3];
  return dd <= 0 ? `hoje/${p}` : dd < 7 ? `${WD_ABBR[new Date(t).getDay()]}/${p}` : `${new Date(t).getDate()}/${pad(new Date(t).getMonth() + 1)}`;
}

export function shortTime(iso: string | number, now: number): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const d = new Date(t);
  const dd = dayDiff(t, now);
  if (dd <= 0) return hm(d);
  if (dd < 7) return WD_ABBR[d.getDay()];
  return `${d.getDate()}/${pad(d.getMonth() + 1)}`;
}

// ------------------------------------------------------------ ritmo

/** Inclinação (pontos/hora) por mínimos quadrados. null sem 2 pontos espaçados ≥ 3 min. */
export function slope(points: { t: number; v: number }[]): number | null {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0;
  if (span < 3 * 60_000) return null;
  const xs = points.map((p) => (p.t - t0) / H);
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = points.reduce((s, p) => s + p.v, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i] - mx) * (p.v - my);
    den += (xs[i] - mx) ** 2;
  });
  return den > 0 ? num / den : null;
}

// ------------------------------------------------------------ veredito

const LABEL = { "5h": "Sessão de 5 h", "7d": "Esta semana", "fable-7d": "Fable na semana" } as const;
const NAME = { "5h": "a sessão de 5 h", "7d": "a semana", "fable-7d": "o Fable na semana" } as const;
const SHORTNAME = { "5h": "5h", "7d": "semana", "fable-7d": "Fable" } as const;

export type VerdictInput = {
  now: number;
  /** leitura mais recente (null = linha de status nunca chegou) */
  latest: Reading | null;
  history: Reading[];
  staleAfterMs?: number;
  fableManual?: FableManual | null;
  fableUsage?: FableUsage;
  lastUsageAt?: number | null;
};

function project(id: VerdictWindow["id"], usedPct: number | null, resetsAt: string | null, rate: number | null, now: number, extra: Partial<VerdictWindow> = {}): VerdictWindow {
  const w: VerdictWindow = {
    id,
    label: LABEL[id],
    usedPct,
    resetsAt,
    resetHuman: resetsAt ? humanTime(resetsAt, now, "reset") : "horário não informado",
    ratePctPerHour: rate,
    hitsAt: null,
    hitsHuman: null,
    exhausts: false,
    projAtReset: null,
    source: "statusline",
    ...extra,
  };
  if (usedPct == null) return w;
  const restante = 100 - usedPct;
  if (rate != null && rate > 0) {
    const hit = now + (restante / rate) * H;
    w.hitsAt = new Date(hit).toISOString();
    w.hitsHuman = humanTime(hit, now, "proj");
    w.exhausts = Boolean(resetsAt && hit < Date.parse(resetsAt));
  }
  if (!w.exhausts) {
    const hours = resetsAt ? Math.max(0, (Date.parse(resetsAt) - now) / H) : 0;
    w.projAtReset = Math.min(100, usedPct + Math.max(0, rate ?? 0) * hours);
  }
  return w;
}

// ------------------------------------------------------------ conta inferida
//
// rate_limits é da CONTA, não da sessão: sessões diferentes da mesma conta descrevem
// o mesmo contador. A conta se infere pela renovação da semana (resetsAt igual, com
// tolerância); sem semana, pela da sessão de 5 h. Sessão ociosa repete o último valor
// que recebeu — por isso uma leitura abaixo do que a conta já mostrou é atraso, não
// queda (o contador de uma janela nunca desce).

const RESET_TOL = 2 * 60_000;
export const sameReset = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && Math.abs(Date.parse(a) - Date.parse(b)) <= RESET_TOL;

function accountReset(r: Reading): string | null {
  return r.seven?.resetsAt ?? r.five?.resetsAt ?? null;
}
export function sameAccount(a: Reading, b: Reading): boolean {
  if (a.seven?.resetsAt && b.seven?.resetsAt) return sameReset(a.seven.resetsAt, b.seven.resetsAt);
  if (a.five?.resetsAt && b.five?.resetsAt) return sameReset(a.five.resetsAt, b.five.resetsAt);
  return accountReset(a) == null || accountReset(b) == null;
}

/**
 * Série única de um contador, todas as sessões juntas, ordenada no tempo.
 * Ruído descartado: (1) pico isolado — a própria sessão informa menos depois
 * (dentro de uma janela o contador nunca desce, então o valor alto foi falha);
 * (2) atraso — abaixo do máximo que o contador já mostrou (sessão ociosa).
 */
export type CounterPoint = { t: number; v: number; s?: string | null };
export function counterSeries(points: CounterPoint[]): { t: number; v: number }[] {
  const p = [...points].sort((a, b) => a.t - b.t);
  // menor valor que cada sessão informa daqui pra frente (varredura de trás pra frente)
  const laterMin = new Map<string, number>();
  const spike = new Array<boolean>(p.length).fill(false);
  for (let i = p.length - 1; i >= 0; i--) {
    const x = p[i];
    if (!x.s) continue;
    const m = laterMin.get(x.s);
    if (m != null && m < x.v) spike[i] = true;
    laterMin.set(x.s, m == null ? x.v : Math.min(m, x.v));
  }
  const noSpike = p.filter((_, i) => !spike[i]);
  const out: { t: number; v: number }[] = [];
  let max = -Infinity;
  for (const x of noSpike) {
    if (x.v < max) continue;
    max = x.v;
    out.push(x);
  }
  return out;
}

/** Inclinação robusta (Theil-Sen, pontos/hora). null sem 2 pontos espaçados ≥ 3 min. */
export function robustSlope(points: { t: number; v: number }[]): number | null {
  if (points.length < 2 || points[points.length - 1].t - points[0].t < 3 * 60_000) return null;
  // com muitos pontos, amostra uniforme para manter o custo O(n²) pequeno
  const step = Math.max(1, Math.ceil(points.length / 300));
  const ps = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const s: number[] = [];
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) if (ps[j].t - ps[i].t >= 60_000) s.push((ps[j].v - ps[i].v) / ((ps[j].t - ps[i].t) / H));
  if (!s.length) return null;
  s.sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeVerdict(inp: VerdictInput): Verdict {
  const { now, latest } = inp;
  const staleAfter = inp.staleAfterMs ?? 15 * 60_000;
  if (!latest || (!latest.five && !latest.seven)) {
    return {
      state: "missing",
      headline: "Ainda sem a leitura do plano. Ative a linha de status do monitor — está em Ajustes.",
      short: "",
      decisive: null,
      windows: fableOnly(inp),
      readAt: latest?.at ?? null,
      sessionTail: null,
    };
  }
  // todas as sessões da conta da leitura mais recente
  const seen = new Set(inp.history.map((h) => h.at + "|" + (h.session ?? "")));
  const hist = [...inp.history, ...(seen.has(latest.at + "|" + (latest.session ?? "")) ? [] : [latest])].filter((h) => Date.parse(h.at) <= now && sameAccount(h, latest));
  const windows: VerdictWindow[] = [];

  // sessão de 5 h
  if (latest.five && (!latest.five.resetsAt || Date.parse(latest.five.resetsAt) > now)) {
    const w5 = latest.five;
    const series = counterSeries(hist.filter((h) => h.five && (w5.resetsAt ? sameReset(h.five.resetsAt, w5.resetsAt) : !h.five.resetsAt)).map((h) => ({ t: Date.parse(h.at), v: h.five!.usedPct, s: h.session })));
    const used = series.length ? series[series.length - 1].v : w5.usedPct;
    const rate = robustSlope(series.filter((p) => now - p.t <= 90 * 60_000));
    windows.push(project("5h", used, w5.resetsAt, rate, now, rate == null ? { note: "ritmo ainda sem pontos suficientes" } : {}));
  } else {
    windows.push({ ...project("5h", null, null, null, now), note: "renovada — aguardando a primeira leitura" });
  }

  // semana: max(regressão 24 h, média desde o início da semana) — sempre projeta
  let weekStart: number | null = null;
  if (latest.seven) {
    const w7 = latest.seven;
    weekStart = w7.resetsAt ? Date.parse(w7.resetsAt) - 7 * D : null;
    const series = counterSeries(hist.filter((h) => h.seven && (w7.resetsAt ? sameReset(h.seven.resetsAt, w7.resetsAt) : !h.seven.resetsAt)).map((h) => ({ t: Date.parse(h.at), v: h.seven!.usedPct, s: h.session })));
    const used = series.length ? series[series.length - 1].v : w7.usedPct;
    const recent = robustSlope(series.filter((p) => now - p.t <= D));
    const hoursSince = weekStart != null ? (now - weekStart) / H : null;
    const avg = hoursSince && hoursSince > 0 ? used / hoursSince : null;
    const rate = recent == null ? avg : avg == null ? recent : Math.max(recent, avg);
    windows.push(project("7d", used, w7.resetsAt, rate, now, { rateAvgPctPerHour: avg, rateRecentPctPerHour: recent }));
  }

  // Fable na semana
  const fm = inp.fableManual;
  const fableResets = latest.seven?.resetsAt ?? fm?.resetsAt ?? null;
  if (fm && (!fm.resetsAt || Date.parse(fm.resetsAt) > now)) {
    const ws = fm.resetsAt ? Date.parse(fm.resetsAt) - 7 * D : weekStart;
    const hoursSince = ws != null ? (now - ws) / H : null;
    const avg = hoursSince && hoursSince > 0 ? fm.pct / hoursSince : null;
    windows.push(project("fable-7d", fm.pct, fm.resetsAt ?? fableResets, avg, now, { source: "manual", rateAvgPctPerHour: avg, manualAt: fm.at, ...fableNote(inp.fableUsage, now) }));
  } else if (inp.fableUsage && inp.fableUsage.tokens > 0) {
    windows.push({ ...project("fable-7d", null, fableResets, null, now), source: "none", ...fableNote(inp.fableUsage, now) });
  }

  // qual janela decide
  const cands = windows.filter((w) => w.usedPct != null);
  const exh = cands.filter((w) => w.exhausts).sort((a, b) => Date.parse(a.hitsAt!) - Date.parse(b.hitsAt!));
  const decisiveW = exh[0] ?? [...cands].sort((a, b) => (b.projAtReset ?? b.usedPct ?? 0) - (a.projAtReset ?? a.usedPct ?? 0))[0] ?? null;
  const full = cands.find((w) => (w.usedPct ?? 0) >= 100);

  let state: VerdictState;
  let headline: string;
  let short: string;
  if (full) {
    state = "exhausted";
    headline = `Sem Claude até ${full.resetHuman}. ${cap(NAME[full.id])} esgotou.`;
    short = `✕ sem Claude até ${full.resetsAt ? shortTime(full.resetsAt, now) : "?"}`;
    return finish(full);
  }
  const d = decisiveW!;
  const hitsIn = d.hitsAt ? Date.parse(d.hitsAt) - now : Infinity;
  const anyOver = (p: number) => cands.some((w) => (w.usedPct ?? 0) >= p);
  const critical = (d.exhausts && (d.id === "5h" ? hitsIn < H : hitsIn < D)) || anyOver(90);
  const attention = exh.length > 0 || anyOver(70);
  if (critical || attention) {
    state = critical ? "critical" : "attention";
    const word = critical ? "Crítico" : "Atenção";
    if (d.exhausts) {
      headline = `${word}. Nesse ritmo, ${NAME[d.id]} esgota ${d.hitsHuman}, antes de renovar ${d.resetHuman}.`;
      short = `⚠ ${SHORTNAME[d.id]} esgota ${shortProj(d.hitsAt!, now)}`;
    } else {
      const hi = [...cands].sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0))[0];
      headline = `${word}. ${cap(NAME[hi.id])} está em ${fmt(hi.usedPct!)} %; renova ${hi.resetHuman}.`;
      short = `⚠ ${SHORTNAME[hi.id]} em ${Math.round(hi.usedPct!)}%`;
      return finish(hi);
    }
    return finish(d);
  }
  // tranquilo — ou ritmo parado
  state = "ok";
  const w5 = windows.find((w) => w.id === "5h");
  const w7 = windows.find((w) => w.id === "7d");
  const still = (w5?.ratePctPerHour == null || w5.ratePctPerHour <= 0) && (w7 ? (w7.rateRecentPctPerHour ?? 0) <= 0 : true);
  if (still && inp.lastUsageAt) {
    const hi = [...cands].sort((a, b) => (b.usedPct ?? 0) - (a.usedPct ?? 0))[0];
    const min = Math.max(1, Math.round((now - inp.lastUsageAt) / 60_000));
    headline = `Tranquilo. Sem consumo há ${min} min; ${NAME[hi.id].replace(/^(a|o) /, "")} em ${fmt(hi.usedPct!)} %.`;
  } else {
    headline = `Tranquilo. Nesse ritmo você chega à renovação de ${d.resetHuman} com ${fmt(d.projAtReset ?? d.usedPct!)} % d${NAME[d.id]}.`;
  }
  short = `✓ chega ${d.resetsAt ? (dayDiff(Date.parse(d.resetsAt), now) <= 0 ? "às " : "na ") + shortTime(d.resetsAt, now) : "à renovação"}`;
  return finish(d);

  function finish(dec: VerdictWindow): Verdict {
    const stale = now - Date.parse(latest!.at) > staleAfter;
    return {
      state: stale ? "stale" : state,
      underlying: state,
      headline,
      short,
      decisive: dec.id,
      windows,
      readAt: latest!.at,
      sessionTail: latest!.session ? latest!.session.slice(-4) : null,
    };
  }
}

function fableOnly(inp: VerdictInput): VerdictWindow[] {
  if (!inp.fableUsage || inp.fableUsage.tokens <= 0) return [];
  return [{ ...project("fable-7d", null, null, null, inp.now), source: "none", ...fableNote(inp.fableUsage, inp.now) }];
}
function fableNote(u: FableUsage | undefined, now: number): Partial<VerdictWindow> {
  if (!u) return {};
  return { fableTokens: u.tokens, fableCost: u.cost, fableSince: u.since, fableSinceHuman: humanTime(u.since, now, "reset") };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");

// ------------------------------------------------------------ outra conta

/**
 * Contas diferentes abertas ao mesmo tempo: nos últimos 10 min, alguma leitura com
 * renovação diferente da conta da leitura mais recente. Sessões da mesma conta com
 * porcentagens diferentes NÃO são aviso — é sessão ociosa repetindo valor antigo.
 */
export function otherAccounts(history: Reading[], now: number): { active: Reading; other: Reading } | null {
  const recent = history.filter((h) => (h.five || h.seven) && now - Date.parse(h.at) <= 10 * 60_000 && Date.parse(h.at) <= now);
  if (!recent.length) return null;
  const active = recent.reduce((a, b) => (Date.parse(b.at) >= Date.parse(a.at) ? b : a));
  const other = [...recent].reverse().find((h) => !sameAccount(h, active));
  return other ? { active, other } : null;
}

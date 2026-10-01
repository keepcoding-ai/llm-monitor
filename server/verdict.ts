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

/** Uma função para toda hora na tela. Projeção é imprecisa → período; reset é exato → hora. */
export function humanTime(iso: string | number, now: number, kind: "proj" | "reset"): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const d = new Date(t);
  const dd = dayDiff(t, now);
  if (dd === 0) return `hoje às ${hm(d)}`;
  if (dd === -1) return `ontem às ${hm(d)}`;
  if (dd < -1 && dd > -7) return `${WD_LONG[d.getDay()]}, ${hm(d)}`;
  if (dd === 1) return `amanhã às ${hm(d)}`;
  if (dd > 0 && dd < 7) return kind === "proj" ? `${WD_PROJ[d.getDay()]} ${period(d.getHours())}` : `${WD_LONG[d.getDay()]}, ${hm(d)}`;
  return `${d.getDate()} de ${MONTH[d.getMonth()]}`;
}

/** Forma curta para a linha de status (≤ 40 caracteres no total). */
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

/** Leituras usadas no ritmo: mesma sessão da mais recente (quando ela tem sessão). */
function sameSession(history: Reading[], latest: Reading): Reading[] {
  if (!latest.session) return history;
  return history.filter((h) => h.session === latest.session);
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
  const hist = sameSession(inp.history, latest).filter((h) => Date.parse(h.at) <= now);
  const windows: VerdictWindow[] = [];

  // sessão de 5 h
  if (latest.five && (!latest.five.resetsAt || Date.parse(latest.five.resetsAt) > now)) {
    const w5 = latest.five;
    const pts = hist.filter((h) => h.five && h.five.resetsAt === w5.resetsAt && now - Date.parse(h.at) <= 90 * 60_000).map((h) => ({ t: Date.parse(h.at), v: h.five!.usedPct }));
    const rate = slope(pts);
    windows.push(project("5h", w5.usedPct, w5.resetsAt, rate, now, rate == null ? { note: "ritmo ainda sem pontos suficientes" } : {}));
  } else {
    windows.push({ ...project("5h", null, null, null, now), note: "renovada — aguardando a primeira leitura" });
  }

  // semana: max(regressão 24 h, média desde o início da semana) — sempre projeta
  let weekStart: number | null = null;
  if (latest.seven) {
    const w7 = latest.seven;
    weekStart = w7.resetsAt ? Date.parse(w7.resetsAt) - 7 * D : null;
    const pts = hist.filter((h) => h.seven && h.seven.resetsAt === w7.resetsAt && now - Date.parse(h.at) <= D).map((h) => ({ t: Date.parse(h.at), v: h.seven!.usedPct }));
    const recent = slope(pts);
    const hoursSince = weekStart != null ? (now - weekStart) / H : null;
    const avg = hoursSince && hoursSince > 0 ? w7.usedPct / hoursSince : null;
    const rate = recent == null ? avg : avg == null ? recent : Math.max(recent, avg);
    windows.push(project("7d", w7.usedPct, w7.resetsAt, rate, now, { rateAvgPctPerHour: avg, rateRecentPctPerHour: recent }));
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
      short = `⚠ ${SHORTNAME[d.id]} esgota ${shortTime(d.hitsAt!, now)}`;
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

// ------------------------------------------------------------ sessões divergentes

/** Última leitura de cada sessão nos últimos 10 min; diferença > 10 pontos na mesma janela. */
export function divergentSessions(history: Reading[], now: number): { window: "5h" | "7d"; a: number; b: number } | null {
  const last = new Map<string, Reading>();
  for (const h of history) {
    if (!h.session || now - Date.parse(h.at) > 10 * 60_000) continue;
    last.set(h.session, h);
  }
  const rows = [...last.values()];
  for (const k of ["seven", "five"] as const) {
    const vals = rows.map((r) => r[k]?.usedPct).filter((v): v is number => v != null);
    if (vals.length < 2) continue;
    const a = Math.max(...vals);
    const b = Math.min(...vals);
    if (a - b > 10) return { window: k === "seven" ? "7d" : "5h", a, b };
  }
  return null;
}


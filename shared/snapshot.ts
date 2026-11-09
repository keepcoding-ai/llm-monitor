// Contrato do snapshot que o backend publica por SSE e os widgets leem.
// Só tipos — servidor e cliente importam daqui.

export type Tokens = { input: number; output: number; cacheWrite: number; cacheRead: number; thinking: number; total: number };
export type Bucket = Tokens & { cost: number; n: number };
export type Named = Bucket & { key: string };

export type LimitWindow = { usedPct: number; resetsAt: string | null };
export type Limits =
  | { state: "missing"; reason: string }
  | { state: "stale"; reason: string; at: string; fiveHour?: LimitWindow; sevenDay?: LimitWindow }
  | { state: "ok"; at: string; fiveHour?: LimitWindow; sevenDay?: LimitWindow; model?: string; version?: string };

export type Autonomy =
  | { basis: "limits"; window: "5h" | "7d"; usedPct: number; ratePctPerHour: number; hitsAt: string | null; resetsAt: string | null; verdict: string }
  | { basis: "trend"; tokensPerHourNow: number; tokensPerHourAvg: number; verdict: string; reason: string };

export type VerdictState = "ok" | "attention" | "critical" | "exhausted" | "missing" | "stale";
export type VerdictWindow = {
  id: "5h" | "7d" | "fable-7d"; label: string; usedPct: number | null; resetsAt: string | null;
  resetHuman: string; ratePctPerHour: number | null; rateAvgPctPerHour?: number | null; rateRecentPctPerHour?: number | null;
  hitsAt: string | null; hitsHuman: string | null; exhausts: boolean; projAtReset: number | null;
  source: "statusline" | "manual" | "official" | "none"; note?: string;
  /** Fable: uso real da semana (tokens/US$ equivalente) e quando o % foi informado à mão */
  fableTokens?: number; fableCost?: number; fableSince?: string; fableSinceHuman?: string; manualAt?: string;
};
export type Verdict = {
  state: VerdictState;
  /** estado do dado por baixo do selo "leitura antiga" */
  underlying?: VerdictState;
  headline: string;
  /** ≤ 40 caracteres, para a linha de status do terminal */
  short: string;
  decisive: VerdictWindow["id"] | null;
  windows: VerdictWindow[];
  readAt: string | null;
  sessionTail: string | null;
};

export type FlagView = { key: string; kind: string; level: "info" | "warning" | "alert" | "error"; title: string; detail: string; firstSeen: string; lastSeen: string; count: number; ack?: boolean };

export type Suggestion = { id: string; origin: "regra" | "pulso"; level: "info" | "notice" | "warning" | "alert"; title: string; detail: string; at: string };

export type SoulAccount = { id: string; providerId: string; label: string; kind: string; tier?: string; masked: string; position: number; isActive: boolean; state: string; resetsAt?: string; lastServedAt?: string };
export type SoulPool = { dir: string; label: string; ok: boolean; error?: string; accounts: SoulAccount[]; activeId?: string; order: string[]; sessionFiles: number };

export type Snapshot = {
  at: string;
  collector: { lastCycleMs: number; filesScanned: number; records: number; backfillDone: boolean; intervalSec: number; claudeVersion?: string; priceTable: string; priceSource: string };
  account: { email: string; name: string } | null;
  settings: { model: string | null; effortLevel: string | null; error?: string };
  catalog: { models: string[]; efforts: string[]; soulModels: string[]; soulEfforts: string[] };
  today: Bucket;
  week: Bucket;
  bySource: Named[];
  hourly: { hour: string; cost: number; total: number; byModel: Record<string, number> }[];
  daily: { day: string; cost: number; total: number }[];
  byModel: Named[];
  byModelWeek: Named[];
  byProject: Named[];
  byProjectToday: Named[];
  /** sessões do Claude Code com resposta nos últimos 30 min; `viva` = processo `claude` ainda rodando (vivas primeiro) */
  bySessionRecent: { session: string; viva: boolean; project: string; models: string[]; lastAt: string; cost: number; cacheRead: number; n: number }[];
  byAccount: Named[];
  sidechainToday: { cost: number; share: number; opusShare: number };
  heatmap: number[][]; // [dia-da-semana 0=dom][hora] custo médio (28 dias)
  windows: { start: string; end: string; cost: number; total: number; active: boolean }[];
  limits: Limits;
  autonomy: Autonomy;
  verdict: Verdict;
  cabe: import("./cabe.ts").Cabe;
  /** troca temporária do modelo padrão ("até a renovação"), desfeita sozinha em `until` */
  semana: {
    weekStart: string | null;
    resetsAt: string | null;
    /** % oficial da semana, um ponto por hora (última leitura da hora) */
    points: { t: string; pct: number }[];
    usedPct: number | null;
    needPerDay: number | null;
    todayPct: number | null;
    cost: number;
    lastWeekCost: number | null;
    byFamily: { key: string; cost: number; share: number }[];
    sideShare: number;
    byProject: { key: string; cost: number; share: number }[];
    windows: { start: string; end: string; cost: number; active: boolean; slack: boolean }[];
    slackBelow: number | null;
  };
  tempDefault: { model: string; previous: string | null; until: string; at: string } | null;
  platform: { todayCost: number; budget: number; calls: number };
  flags: FlagView[];
  suggestions: Suggestion[];
  soul: SoulPool[];
  pulse: { enabled: boolean; model: string; lastAt: string | null; nextAt: string | null; running: boolean; last?: PulseRecord | null };
};

export type PulseRecord = {
  at: string;
  model: string;
  ok: boolean;
  findings: string[];
  escalate: "none" | "sonnet" | "opus" | "fable";
  costUSD: number | null;
  error?: string;
  escalation?: { model: string; status: string; proposal?: string; note?: string };
};

export type WidgetVersion = { v: number; status: "active" | "testing" | "failed" | "retired" | "checking"; at: string; note: string; error?: string };
export type PageKind = "grid" | "single" | "settings";
export type PageDef = { id: string; title: string; /** nome de ícone Phosphor (lista fechada em ICON_NAMES) */ icon: string; order: number; kind: PageKind; menu: boolean; fixed: boolean };
export type PageId = string;
export const ICON_NAMES = ["House", "ArrowsClockwise", "Lifebuoy", "GearSix", "Warning", "ChartBar", "Gauge", "Lightning", "Folder", "Star", "Clock", "Coins"] as const;

/** Altura em meias-linhas da grade: 2 = a largura de uma coluna (célula quadrada). */
export type SlotH = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type SlotSpec = {
  id: string;
  widget: string;
  version: number;
  page: string;
  order: number;
  w: 1 | 2 | 3;
  h: SlotH;
  title?: string;
};
export type WidgetMeta = {
  id: string;
  title: string;
  description: string;
  /** versioned: widgets/<id>/v<n>.tsx · builtin: componente de código ligado ao shell */
  source: "versioned" | "builtin";
  size: { w: 1 | 2 | 3; h: SlotH };
  createdBy: "system" | "owner" | "chat";
  createdAt: string;
};
export type Layout = {
  rev: 6;
  pages: PageDef[];
  slots: SlotSpec[];
  /** derivada de widgets/<id>/manifest.json (scanCollection); não é gravada em disco */
  collection: WidgetMeta[];
  versions: Record<string, WidgetVersion[]>;
  history: Record<string, number[]>;
};

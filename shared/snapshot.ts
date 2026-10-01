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
  byAccount: Named[];
  sidechainToday: { cost: number; share: number; opusShare: number };
  heatmap: number[][]; // [dia-da-semana 0=dom][hora] custo médio (28 dias)
  windows: { start: string; end: string; cost: number; total: number; active: boolean }[];
  limits: Limits;
  autonomy: Autonomy;
  platform: { todayCost: number; budget: number; calls: number };
  flags: FlagView[];
  suggestions: Suggestion[];
  soul: SoulPool[];
  pulse: { lastAt: string | null; nextAt: string | null; running: boolean; last?: PulseRecord | null };
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
export type SlotSpec = { id: string; widget: string; version: number; span: { md: number; xl: number; tv: number }; title: string };
export type Layout = { slots: SlotSpec[]; versions: Record<string, WidgetVersion[]>; history: Record<string, number[]> };

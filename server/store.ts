// Caminhos e persistência em disco. Todo estado da plataforma vive em state/,
// dentro da pasta do app. Escrita sempre atômica (tmp + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STATE = join(APP_ROOT, "state");
export const WIDGETS_DIR = join(APP_ROOT, "widgets");
/** Pasta onde a plataforma roda os próprios `claude -p` — é por ela (o cwd
 *  gravado nos jsonl) que o coletor separa o gasto da plataforma. */
export const AGENT_WORK = join(STATE, "agent-work");
export const HOME = homedir();

export const P = {
  config: join(STATE, "config.json"),
  prices: join(STATE, "prices.json"),
  models: join(STATE, "models.json"),
  layout: join(STATE, "layout.json"),
  flags: join(STATE, "flags.json"),
  offsets: join(STATE, "collector", "offsets.json"),
  series: join(STATE, "collector", "series.jsonl"),
  collectorMeta: join(STATE, "collector", "meta.json"),
  statusline: join(STATE, "statusline.json"),
  statuslineHistory: join(STATE, "statusline-history.jsonl"),
  pulses: join(STATE, "memory", "pulses.jsonl"),
  decisions: join(STATE, "memory", "decisions.jsonl"),
  platformSpend: join(STATE, "memory", "platform-spend.jsonl"),
  proposals: join(STATE, "proposals"),
  chat: join(STATE, "chat", "history.jsonl"),
  chatSession: join(STATE, "chat", "session.json"),
  backups: join(STATE, "backups"),
  derived: join(STATE, "derived.json"),
  fableManual: join(STATE, "fable-manual.json"),
  tempDefault: join(STATE, "temp-default.json"),
  cabeEstimates: join(STATE, "memory", "cabe-estimates.jsonl"),
  cabeChecks: join(STATE, "memory", "cabe-checks.jsonl"),
};

export function expandHome(p: string): string {
  return p.startsWith("~") ? join(HOME, p.slice(1)) : p;
}

export function readJson<T>(path: string, fallback: T): T {
  // Ausência é estado inicial legítimo; JSON corrompido é erro alto.
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function appendJsonl(path: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* última linha rasgada durante append */
    }
  }
  return out;
}

// ---------------------------------------------------------------- config

export type SoulPoolConfig = { dir: string; label: string; sessionRoots: string[] };
export type Config = {
  collectIntervalSec: number;
  soulPools: SoulPoolConfig[];
  pulse: { enabled: boolean; everyMinutes: number; model: string; autoEscalate: boolean };
  chatModel: string;
  platformDailyBudgetUSD: number;
};

export const DEFAULT_CONFIG: Config = {
  collectIntervalSec: 15,
  soulPools: [{ dir: "~/.soul", label: "Soul (padrão)", sessionRoots: [] }],
  pulse: { enabled: true, everyMinutes: 60, model: "haiku", autoEscalate: false },
  chatModel: "haiku",
  platformDailyBudgetUSD: 2,
};

export function loadConfig(): Config {
  const c = readJson<Partial<Config>>(P.config, {});
  return { ...DEFAULT_CONFIG, ...c, pulse: { ...DEFAULT_CONFIG.pulse, ...(c.pulse ?? {}) } };
}

/** Semeia os arquivos de estado na primeira subida (nunca sobrescreve). */
export function seedState(): void {
  mkdirSync(AGENT_WORK, { recursive: true });
  if (!existsSync(P.config)) writeJson(P.config, DEFAULT_CONFIG);
  if (!existsSync(P.prices)) writeJson(P.prices, DEFAULT_PRICES);
  if (!existsSync(P.models)) writeJson(P.models, DEFAULT_MODELS);
}

// Tabela de preço (USD por milhão de tokens), primeira-parte da API. Assinatura
// do Claude Code não cobra por token: o valor é "equivalente API", para comparar.
// Ordem importa: primeiro `match` (prefixo do id do modelo) que casar vence.
export type PriceRow = { match: string; input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };
export type PriceTable = { version: string; source: string; models: PriceRow[] };
export const DEFAULT_PRICES: PriceTable = {
  version: "2026-09-25",
  source: "Tabela pública da API Anthropic (cache 2026-09-25). Escrita de cache: 1,25× (5 min) e 2× (1 h) do preço de entrada.",
  models: [
    { match: "claude-opus-5-5", input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
    { match: "claude-opus-5", input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    { match: "claude-opus-4", input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    { match: "claude-fable-5", input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
    { match: "claude-mythos-5", input: 10, output: 50, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25 },
    { match: "claude-sonnet-5", input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
    { match: "claude-sonnet-4", input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
    { match: "claude-haiku-4", input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  ],
};

export type ModelsCatalog = { claude: { models: string[]; efforts: string[] } };
export const DEFAULT_MODELS: ModelsCatalog = {
  claude: {
    // Apelidos que o Claude Code aceita em `model`; ids completos vistos nos
    // dados são somados em tempo de execução.
    models: ["opus", "sonnet", "haiku", "fable", "opusplan"],
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
};

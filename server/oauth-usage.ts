// Uso oficial do plano (Claude Code /usage): GET api.anthropic.com/api/oauth/usage.
// SEGURANÇA: o token só vive em memória, dentro desta função. Nunca é logado, devolvido, gravado ou colocado em erro.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type OfficialWindow = { usedPct: number; resetsAt: string | null };
/**
 * Forma da resposta, só NOMES e tipos (nunca valores): serve para ver a olho se o fornecedor trouxe
 * ou não uma janela. Ausência de janela é circunstância observada (promoções e regras mudam), não erro.
 */
export type OfficialDebug = {
  /** chave de topo -> tipo ("null", "number", "array(n)", "object{a,b}", ...) */
  shape: Record<string, string>;
  /** limits[]: kind (e escopo, se houver) de cada item */
  limitKinds: string[];
};
export type OfficialUsage = {
  state: "ok" | "unavailable";
  reason?: string;
  at: string;
  /** nomes das chaves de topo da resposta (sem valores) */
  keys: string[];
  five?: OfficialWindow;
  seven?: OfficialWindow;
  /** chave seven_day_* do Fable/Mythos, se existir */
  fable?: OfficialWindow;
  fableKey?: string;
  debug?: OfficialDebug;
};

const TTL = 60_000;
let cache: { at: number; value: OfficialUsage } | null = null;
let inflight: Promise<OfficialUsage> | null = null;

function token(): { token: string } | { reason: string } {
  const env = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (env) return { token: env };
  const file = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(file)) return { reason: "credenciais do Claude Code não encontradas" };
  try {
    const o = JSON.parse(readFileSync(file, "utf8"))?.claudeAiOauth;
    if (!o?.accessToken) return { reason: "sem token OAuth do Claude Code" };
    if (typeof o.expiresAt === "number" && o.expiresAt <= Date.now()) return { reason: "token OAuth expirado — abra o Claude Code para renovar" };
    return { token: String(o.accessToken) };
  } catch {
    return { reason: "credenciais ilegíveis" };
  }
}

/** Nome vindo de fora: só caracteres de identificador, curto. Nunca um valor da resposta. */
const name = (x: unknown) => String(x ?? "").replace(/[^\w.\-: ]/g, "?").slice(0, 40);
function tag(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "object") return `object{${Object.keys(v as object).slice(0, 12).map(name).join(",")}}`;
  return typeof v;
}
export function describeShape(j: any): OfficialDebug {
  const shape: Record<string, string> = {};
  for (const k of Object.keys(j ?? {}).slice(0, 40)) shape[name(k)] = tag(j[k]);
  const limitKinds = Array.isArray(j?.limits)
    ? j.limits.slice(0, 20).map((l: any) => `${name(l?.kind)}${l?.scope?.model?.display_name ? `:${name(l.scope.model.display_name)}` : ""}`)
    : [];
  return { shape, limitKinds };
}

const win = (x: any): OfficialWindow | undefined =>
  x && typeof x.utilization === "number" ? { usedPct: x.utilization, resetsAt: typeof x.resets_at === "string" ? x.resets_at : null } : undefined;

async function fetchOnce(): Promise<OfficialUsage> {
  const at = new Date().toISOString();
  const t = token();
  if (!("token" in t)) return { state: "unavailable", reason: t.reason, at, keys: [] };
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${t.token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { state: "unavailable", reason: `HTTP ${res.status}`, at, keys: [] };
    const j: any = await res.json();
    const keys = Object.keys(j ?? {});
    let fableKey = keys.find((k) => /fable|mythos/i.test(k) && win(j[k]));
    let fable = fableKey ? win(j[fableKey]) : undefined;
    // o Fable vem em limits[] como weekly_scoped com scope.model.display_name
    if (!fable && Array.isArray(j.limits)) {
      const l = j.limits.find((x: any) => x?.kind === "weekly_scoped" && /fable|mythos/i.test(String(x?.scope?.model?.display_name ?? "")));
      if (l && typeof l.percent === "number") {
        fable = { usedPct: l.percent, resetsAt: typeof l.resets_at === "string" ? l.resets_at : null };
        fableKey = "limits[weekly_scoped:Fable]";
      }
    }
    return { state: "ok", at, keys, five: win(j.five_hour), seven: win(j.seven_day), fable, fableKey, debug: describeShape(j) };
  } catch (e) {
    return { state: "unavailable", reason: e instanceof Error && e.name === "TimeoutError" ? "tempo esgotado" : "falha de rede", at, keys: [] };
  }
}

/** Busca com cache de ~60 s; nunca lança. */
export function getOfficialUsage(): Promise<OfficialUsage> {
  if (cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.value);
  inflight ??= fetchOnce().then((v) => {
    cache = { at: Date.now(), value: v };
    inflight = null;
    return v;
  });
  return inflight;
}

/** Última leitura já em cache (síncrono, para o veredito). */
export function peekOfficialUsage(): OfficialUsage | null {
  return cache?.value ?? null;
}

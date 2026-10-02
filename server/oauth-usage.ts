// Uso oficial do plano (Claude Code /usage): GET api.anthropic.com/api/oauth/usage.
// SEGURANÇA: o token só vive em memória, dentro desta função. Nunca é logado, devolvido, gravado ou colocado em erro.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type OfficialWindow = { usedPct: number; resetsAt: string | null };
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
    return { state: "ok", at, keys, five: win(j.five_hour), seven: win(j.seven_day), fable, fableKey };
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

// A leitura oficial (/api/oauth/usage) como Reading do veredito e do histórico.
// Funções puras: sem disco, sem rede, sem token.
import type { OfficialUsage } from "./oauth-usage.ts";
import type { Reading } from "./verdict.ts";

/** Quanto tempo uma leitura (oficial ou da statusline) vale como "atual". */
export const FRESH_MS = 15 * 60_000;

/** Leitura oficial utilizável: resposta ok e com ao menos uma janela. Ausência de janela não é erro. */
export function officialReading(u: OfficialUsage | null | undefined): Reading | null {
  if (!u || u.state !== "ok" || (!u.five && !u.seven)) return null;
  return { at: u.at, session: null, source: "official", five: u.five, seven: u.seven };
}

/**
 * Fonte primária dos limites: a oficial, quando fresca; a statusline é reserva.
 * Sem oficial fresca, vale a mais recente das duas (oficial velha ainda ganha de statusline mais velha ainda).
 */
export function pickLatest(statusline: Reading | null, official: Reading | null, now: number): Reading | null {
  if (official && now - Date.parse(official.at) < FRESH_MS) return official;
  if (statusline && official) return Date.parse(official.at) > Date.parse(statusline.at) ? official : statusline;
  return statusline ?? official;
}

/** Assinatura do que importa para o histórico: só os dois contadores. */
export const officialSig = (r: Reading) => JSON.stringify([r.five, r.seven]);

export const RECORD_EVERY_MS = 15 * 60_000;

/** Grava no histórico quando a leitura muda e, mesmo parada, ao menos a cada 15 min (não a cada poll). */
export function shouldRecordOfficial(last: { sig: string; t: number } | null, r: Reading, nowMs: number): boolean {
  return !last || last.sig !== officialSig(r) || nowMs - last.t >= RECORD_EVERY_MS;
}

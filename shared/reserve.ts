// Reserva (plano §11 passo 4): próxima conta recomendada de um pool Soul.
// Regra: conta "ok" que não é a ativa, com o reset mais distante (sem reset
// informado = nenhuma janela correndo = a mais folgada). Pool com 1 conta → "só 1 conta".
import type { SoulAccount, SoulPool } from "./snapshot.ts";

export type Recommendation = { kind: "single" } | { kind: "none" } | { kind: "account"; account: SoulAccount };

export function recommend(pool: SoulPool): Recommendation {
  if (pool.accounts.length <= 1) return { kind: "single" };
  const ok = pool.accounts.filter((a) => a.state === "ok" && !a.isActive);
  if (!ok.length) return { kind: "none" };
  const key = (a: SoulAccount) => (a.resetsAt ? Date.parse(a.resetsAt) : Number.POSITIVE_INFINITY);
  return { kind: "account", account: [...ok].sort((a, b) => key(b) - key(a) || a.position - b.position)[0] };
}

// Regra da notificação do browser (opt-in): uma por transição, nunca repetida.
// Compartilhada entre o cliente (que notifica) e os testes.

const RANK: Record<string, number> = { missing: 0, ok: 1, attention: 2, critical: 3, exhausted: 4 };
/** A notificação dispara quando o estado sobe ou uma janela cruza 70/90 %. */
export function shouldNotify(prev: { state: string; bands: Record<string, number> } | null, cur: { state: string; bands: Record<string, number> }): string | null {
  if (!prev) return null;
  if ((RANK[cur.state] ?? 0) > (RANK[prev.state] ?? 0) && (RANK[prev.state] ?? 0) >= 1) return "estado";
  for (const [k, b] of Object.entries(cur.bands)) if (b > (prev.bands[k] ?? 0)) return `faixa:${k}`;
  return null;
}
export function band(p: number | null): number {
  return p == null ? 0 : p >= 90 ? 2 : p >= 70 ? 1 : 0;
}

// Barramento SSE: um canal único por cliente, eventos temáticos.
// O payload é serializado UMA vez por evento (não uma por cliente): com N abas abertas o snapshot
// de ~85 KB não vira N JSON.stringify a cada publicação.
export type BusEvent = { event: string; data: unknown; json: () => string };
type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();

export function publish(event: string, data: unknown): void {
  if (listeners.size === 0) return;
  let s: string | undefined;
  const e: BusEvent = { event, data, json: () => (s ??= JSON.stringify(data)) };
  for (const l of listeners) l(e);
}
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function clientCount(): number {
  return listeners.size;
}

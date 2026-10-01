// Barramento SSE: um canal único por cliente, eventos temáticos.
export type BusEvent = { event: string; data: unknown };
type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();

export function publish(event: string, data: unknown): void {
  for (const l of listeners) l({ event, data });
}
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function clientCount(): number {
  return listeners.size;
}

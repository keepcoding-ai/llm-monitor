// SDK dos widgets: estado vivo (SSE), chamadas à API e formatação.
// Todo widget importa daqui — é o contrato estável entre o shell e as versões.
import { useSyncExternalStore } from "react";
import type { Layout, Snapshot } from "../shared/snapshot.ts";

export type { Snapshot, Layout } from "../shared/snapshot.ts";
export const BASE = "/llm-monitor";
export const API = `${BASE}/api/v1`;

export type ChatEvent =
  | { type: "message"; message: ChatMsg }
  | { type: "start"; id: string }
  | { type: "delta"; id: string; text: string }
  | { type: "error"; error: string };
export type ChatMsg = { id: string; role: "user" | "assistant"; text: string; at: string; costUSD?: number | null; error?: string };

type State = {
  snapshot: Snapshot | null;
  layout: Layout | null;
  connected: boolean;
  progress: { files: number; records: number } | null;
  collectorError: string | null;
  pulseRunning: boolean;
};

let state: State = { snapshot: null, layout: null, connected: false, progress: null, collectorError: null, pulseRunning: false };
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

const chatSubs = new Set<(e: ChatEvent) => void>();
export function onChat(f: (e: ChatEvent) => void) {
  chatSubs.add(f);
  return () => chatSubs.delete(f);
}
const testSubs = new Set<(t: { widget: string; v: number }) => void>();
export function onWidgetTest(f: (t: { widget: string; v: number }) => void) {
  testSubs.add(f);
  return () => testSubs.delete(f);
}

let es: EventSource | null = null;
let lastEvent = Date.now();
// Vigia: o servidor manda ping a cada 25 s. Um proxy pode manter o canal aberto
// depois que o backend caiu, sem erro; sem nenhum evento em 40 s, reconecta.
setInterval(() => {
  if (es && Date.now() - lastEvent > 40_000) {
    es.close();
    es = null;
    set({ connected: false });
    connect();
  }
}, 5_000);
export function connect() {
  if (es) return;
  lastEvent = Date.now();
  es = new EventSource(`${API}/events`);
  es.onopen = () => set({ connected: true });
  es.onerror = () => set({ connected: false });
  es.addEventListener("ping", () => (lastEvent = Date.now()));
  es.onmessage = () => (lastEvent = Date.now());
  for (const ev of ["snapshot", "layout", "progress", "pulse", "chat", "widget-test", "collector-error", "proposals"]) es.addEventListener(ev, () => (lastEvent = Date.now()));
  es.addEventListener("snapshot", (e) => set({ snapshot: JSON.parse((e as MessageEvent).data), collectorError: null }));
  es.addEventListener("layout", (e) => set({ layout: JSON.parse((e as MessageEvent).data) }));
  es.addEventListener("progress", (e) => set({ progress: JSON.parse((e as MessageEvent).data) }));
  es.addEventListener("collector-error", (e) => set({ collectorError: JSON.parse((e as MessageEvent).data).error }));
  es.addEventListener("pulse", (e) => set({ pulseRunning: JSON.parse((e as MessageEvent).data).running }));
  es.addEventListener("chat", (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as ChatEvent;
    chatSubs.forEach((f) => f(ev));
  });
  es.addEventListener("widget-test", (e) => {
    const t = JSON.parse((e as MessageEvent).data);
    testSubs.forEach((f) => f(t));
  });
}

export function useLive<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}
export const useSnapshot = () => useLive((s) => s.snapshot);
export const useLayout = () => useLive((s) => s.layout);

export async function call<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data as { error?: string })?.error ?? `HTTP ${r.status}`);
  return data as T;
}

// ------------------------------------------------------------ formatação

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? "—" : `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
export function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return String(Math.round(n));
}
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const hhmm = (iso: string | number) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export function ago(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}
/** Nome amigável de um id de modelo (claude-opus-5-5 → Opus 5.5). */
export function modelName(id: string): string {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  const fam = m[1][0].toUpperCase() + m[1].slice(1);
  const minor = m[3] && m[3].length <= 2 ? `.${m[3]}` : "";
  return `${fam} ${m[2]}${minor}`;
}
/** Cor de gráfico por família de modelo (cor crua: categoria, sem semântica). */
export function modelColor(id: string): string {
  if (/opus/.test(id)) return "var(--x-purple)";
  if (/sonnet/.test(id)) return "var(--x-sky)";
  if (/haiku/.test(id)) return "var(--x-teal)";
  if (/fable|mythos/.test(id)) return "var(--x-magenta)";
  return "var(--x-faint)";
}

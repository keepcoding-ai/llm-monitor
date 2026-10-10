// SDK dos widgets: estado vivo (SSE), chamadas à API e formatação.
// Todo widget importa daqui — é o contrato estável entre o shell e as versões.
import { useSyncExternalStore } from "react";
import type { Layout, PageDef, SlotSpec, Snapshot } from "../shared/snapshot.ts";
import type { ChatStep } from "../shared/chat.ts";

export type { Snapshot, Layout } from "../shared/snapshot.ts";
export type { ChatStep } from "../shared/chat.ts";
export const BASE = "/llm-monitor";
export const API = `${BASE}/api/v1`;

export type ChatEvent =
  | { type: "message"; message: ChatMsg }
  | { type: "start"; id: string }
  | { type: "delta"; id: string; text: string }
  | { type: "step"; id: string; step: ChatStep }
  | { type: "step-done"; id: string; stepId: string; ok: boolean; output: string }
  | { type: "error"; error: string }
  | { type: "widget"; id: string; v: number; status: "active" | "testing" | "failed"; title: string }
  | { type: "reset" };
export type ChatMsg = { id: string; role: "user" | "assistant"; text: string; at: string; costUSD?: number | null; error?: string; attachments?: { name: string; type: string; file: string }[]; steps?: ChatStep[] };

type State = {
  snapshot: Snapshot | null;
  layout: Layout | null;
  connected: boolean;
  progress: { files: number; records: number } | null;
  collectorError: string | null;
  pulseRunning: boolean;
  /** O server avisou que reinicia ao fim da resposta em curso; zera quando o canal volta do reinício. */
  restartPending: boolean;
  /** Estado do canal com o serviço: ao vivo, soluço recente (até ~10 s) ou fora do ar. */
  link: Link;
  /** Momento (ms) do último evento recebido do serviço — qualquer evento, inclusive ping. */
  lastEventAt: number | null;
  /** Momento (ms) em que o canal caiu; null quando ao vivo. */
  downSince: number | null;
};
export type Link = "live" | "reconnecting" | "down";
/** Tempo de soluço tolerado antes de declarar o serviço fora do ar. */
const GRACE_MS = 10_000;

let state: State = { snapshot: null, layout: null, connected: false, progress: null, collectorError: null, pulseRunning: false, restartPending: false, link: "reconnecting", lastEventAt: null, downSince: null };
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
let everConnected = false;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function touch() {
  lastEvent = Date.now();
  if (state.link !== "live") return markLive();
  state.lastEventAt = lastEvent; // sem notificar: o "há Xs" vem do tick, não de cada ping
}
function markLive() {
  everConnected = true;
  if (graceTimer) clearTimeout(graceTimer), (graceTimer = null);
  set({ connected: true, link: "live", downSince: null, lastEventAt: Date.now() });
}
/** Perdeu o canal: soluço por até GRACE_MS, depois "fora do ar". Sem nunca ter conectado, já é "fora do ar". */
function markLost() {
  if (state.link === "down") return;
  if (!everConnected) return set({ connected: false, link: "down", downSince: state.downSince ?? Date.now() });
  if (state.link === "reconnecting" && graceTimer) return;
  set({ connected: false, link: "reconnecting", downSince: Date.now() });
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (state.link !== "live") set({ link: "down" });
  }, GRACE_MS);
}
function drop() {
  if (retryTimer) clearTimeout(retryTimer), (retryTimer = null);
  if (es) es.close();
  es = null;
}

// Vigia: o servidor manda ping a cada 25 s. Um proxy pode manter o canal aberto
// depois que o backend caiu, sem erro; sem nenhum evento em 40 s, reconecta.
setInterval(() => {
  if (es && Date.now() - lastEvent > 40_000) {
    drop();
    markLost();
    connect();
  }
}, 5_000);

/** Abre o canal SSE. Idempotente: nunca cria dois EventSource. */
export function connect() {
  if (es) return;
  lastEvent = Date.now();
  const src = new EventSource(`${API}/events`);
  es = src;
  src.onopen = () => {
    if (es !== src) return;
    // canal de volta depois de ter caído: o server novo nasce sem reinício pendente
    if (state.restartPending && state.link !== "live") set({ restartPending: false });
    markLive();
  };
  src.onerror = () => {
    if (es !== src) return;
    markLost();
    // 502/404 do proxy fecham o EventSource de vez (sem auto-retry): reabrimos nós.
    if (src.readyState === EventSource.CLOSED && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (es === src) (es = null), connect();
      }, 5_000);
    }
  };
  src.addEventListener("ping", touch);
  src.onmessage = touch;
  for (const ev of ["snapshot", "layout", "progress", "pulse", "chat", "system", "widget-test", "collector-error", "proposals"]) src.addEventListener(ev, touch);
  src.addEventListener("snapshot", (e) => set({ snapshot: JSON.parse((e as MessageEvent).data), collectorError: null }));
  src.addEventListener("layout", (e) => set({ layout: JSON.parse((e as MessageEvent).data) }));
  src.addEventListener("progress", (e) => set({ progress: JSON.parse((e as MessageEvent).data) }));
  src.addEventListener("collector-error", (e) => set({ collectorError: JSON.parse((e as MessageEvent).data).error }));
  src.addEventListener("pulse", (e) => set({ pulseRunning: JSON.parse((e as MessageEvent).data).running }));
  src.addEventListener("system", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { restartPending?: boolean };
    if (typeof d.restartPending === "boolean") set({ restartPending: d.restartPending });
  });
  src.addEventListener("chat", (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as ChatEvent;
    chatSubs.forEach((f) => f(ev));
  });
  src.addEventListener("widget-test", (e) => {
    const t = JSON.parse((e as MessageEvent).data);
    testSubs.forEach((f) => f(t));
  });
}

/** "Tentar agora": fecha o canal atual e reabre na hora. */
export function reconnectNow() {
  drop();
  connect();
}

/** Estado do vínculo com o serviço + se o que está em tela é leitura antiga. */
export const useLink = () => useLive((s) => s.link);
export const useDownSince = () => useLive((s) => s.downSince);
export const useRestartPending = () => useLive((s) => s.restartPending);
export const useStale = () => useLive((s) => s.link !== "live" && s.snapshot != null);

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

// ------------------------------------------------------------ montagem das páginas (layout)
// Toda mutação publica `layout` por SSE; a tela reage a esse evento, não ao retorno.

export const addSlot = (page: string, widget: string, size?: { w?: SlotSpec["w"]; h?: SlotSpec["h"] }) =>
  call<SlotSpec>(`/pages/${encodeURIComponent(page)}/slots`, { body: { widget, ...size } });
export const updateSlot = (id: string, patch: Partial<Pick<SlotSpec, "w" | "h" | "page" | "title">>) =>
  call<SlotSpec>(`/slots/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
export const removeSlot = (id: string) => call<{ ok: true }>(`/slots/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderSlots = (page: string, ids: string[]) =>
  call<{ ok: true }>(`/pages/${encodeURIComponent(page)}/slots/order`, { method: "PUT", body: { ids } });

// páginas: criar, renomear/trocar ícone/menu, apagar (recusa `fixed`) e reordenar o menu (ids = todas as páginas)
export const createPage = (title: string, icon: string) => call<PageDef>("/pages", { body: { title, icon } });
export const updatePage = (id: string, patch: Partial<Pick<PageDef, "title" | "icon" | "menu">>) =>
  call<PageDef>(`/pages/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
export const deletePage = (id: string) => call<{ ok: true; removedSlots: number }>(`/pages/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderPages = (ids: string[]) => call<{ ok: true }>("/pages/order", { method: "PUT", body: { ids } });

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

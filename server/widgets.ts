// Plataforma viva: slots em state/layout.json, widgets em widgets/<id>/v<n>.tsx.
//
// Decisão: o próprio Vite serve os widgets por import dinâmico
// (`import("/llm-monitor/widgets/<id>/v<n>.tsx")`). Assim cada versão nova
// compartilha o MESMO grafo de dependências do app (uma React, um framer-motion,
// um core-ui) sem shim nem bundle paralelo, e o Vite transforma o TSX na hora.
// Versões são imutáveis (arquivo novo a cada troca), então o HMR nunca troca
// um slot por baixo do fluxo de validação.
//
// Fluxo de troca: grava v<n+1> → typecheck (tsc só desse arquivo e do que ele
// importa) → render de teste no navegador (harness oculto, ErrorBoundary) →
// só então o slot aponta para a versão nova e o cliente anima a entrada.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AGENT_WORK, APP_ROOT, P, STATE, WIDGETS_DIR, appendJsonl, readJson, writeJson } from "./store.ts";
import { publish, clientCount } from "./bus.ts";
import { clearFlag, raiseFlag } from "./flags.ts";
import { ICON_NAMES, type Layout, type PageDef, type SlotSpec, type WidgetMeta, type WidgetVersion } from "../shared/snapshot.ts";

// Revisão do layout: quando muda, pages e slots são refeitos a partir dos defaults
// (versions e history preservados; versão ativa de cada widget mantida). A migração é
// a função pura migrateLayout; loadLayout só faz o I/O (backup antes de gravar).
export const LAYOUT_REV = 5;

const DEFAULT_PAGES: PageDef[] = [
  { id: "agora", title: "Agora", icon: "House", order: 10, kind: "grid", menu: true, fixed: true },
  { id: "ciclo", title: "Ciclo", icon: "ArrowsClockwise", order: 20, kind: "grid", menu: true, fixed: true },
  { id: "reserva", title: "Reserva", icon: "Lifebuoy", order: 30, kind: "single", menu: true, fixed: true },
  { id: "ajustes", title: "Ajustes", icon: "GearSix", order: 40, kind: "settings", menu: true, fixed: true },
  { id: "avisos", title: "Avisos", icon: "Warning", order: 50, kind: "single", menu: false, fixed: true },
];

type DefaultSlot = { page: string; widget: string; w: SlotSpec["w"]; h: SlotSpec["h"] };
const DEFAULT_SLOTS: DefaultSlot[] = [
  { page: "agora", widget: "veredito", w: 2, h: 1 },
  { page: "agora", widget: "cabe", w: 1, h: 1 },
  { page: "agora", widget: "semana-ritmo", w: 2, h: 1 },
  { page: "agora", widget: "o-que-comeu", w: 1, h: 2 },
  { page: "agora", widget: "janelas", w: 1, h: 1 },
  { page: "ciclo", widget: "semana-ritmo", w: 3, h: 1 },
  { page: "ciclo", widget: "o-que-comeu", w: 2, h: 2 },
  { page: "ciclo", widget: "janelas", w: 1, h: 2 },
  { page: "reserva", widget: "reserva", w: 3, h: 2 },
  { page: "avisos", widget: "avisos", w: 3, h: 2 },
];
/** Widgets de código (sem v<n>.tsx): não têm versão; o slot guarda 0. */
const BUILTIN_WIDGETS = new Set(["veredito", "cabe"]);

export function versionsOnDisk(id: string): number[] {
  const dir = join(WIDGETS_DIR, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^v(\d+)\.tsx$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Layout de uma revisão anterior (só o que a migração lê). */
type OldLayout = { rev?: number; slots?: { widget: string; version: number }[]; versions?: Layout["versions"]; history?: Layout["history"] };

/** Pura: rev anterior (ou nada) → rev 5 com pages e slots default. `collection` fica vazia (é derivada à parte). */
export function migrateLayout(old: OldLayout | null, onDisk: (widget: string) => number[], now = new Date().toISOString()): Layout {
  const prev = old ? structuredClone(old) : null;
  const fresh: Layout = { rev: LAYOUT_REV, pages: structuredClone(DEFAULT_PAGES), slots: [], collection: [], versions: prev?.versions ?? {}, history: prev?.history ?? {} };
  for (const d of DEFAULT_SLOTS) {
    const id = `${d.page}-${d.widget}`;
    if (BUILTIN_WIDGETS.has(d.widget)) {
      fresh.slots.push({ id, widget: d.widget, version: 0, page: d.page, order: (fresh.slots.filter((s) => s.page === d.page).length + 1) * 10, w: d.w, h: d.h });
      continue;
    }
    const vs = onDisk(d.widget);
    if (vs.length === 0) continue;
    const known = fresh.versions[d.widget];
    const active = prev?.slots?.find((s) => s.widget === d.widget)?.version ?? known?.find((x) => x.status === "active")?.v ?? vs[vs.length - 1];
    fresh.slots.push({ id, widget: d.widget, version: active, page: d.page, order: (fresh.slots.filter((s) => s.page === d.page).length + 1) * 10, w: d.w, h: d.h });
    if (!known) fresh.versions[d.widget] = vs.map((v) => ({ v, status: v === active ? "active" : "retired", at: now, note: "versão inicial" }));
    else for (const v of vs) if (!known.some((x) => x.v === v)) known.push({ v, status: v === active ? "active" : "retired", at: now, note: "versão inicial" });
    if (!fresh.history[d.widget]?.length) fresh.history[d.widget] = [active];
  }
  return fresh;
}

/** Varre widgets/<id>/manifest.json. Widget sem manifest (ou com manifest inválido) fica invisível na coleção. */
export function scanCollection(dir: string = WIDGETS_DIR): WidgetMeta[] {
  if (!existsSync(dir)) return [];
  const out: WidgetMeta[] = [];
  for (const id of readdirSync(dir).sort()) {
    const file = join(dir, id, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8")) as Partial<WidgetMeta>;
      const okSize = m.size && [1, 2, 3].includes(m.size.w) && [1, 2, 3, 4].includes(m.size.h);
      if (m.id !== id || !m.title || (m.source !== "versioned" && m.source !== "builtin") || !okSize) continue;
      out.push({
        id,
        title: m.title,
        description: m.description ?? "",
        source: m.source,
        size: m.size!,
        createdBy: m.createdBy === "owner" || m.createdBy === "chat" ? m.createdBy : "system",
        createdAt: m.createdAt ?? "",
      });
    } catch {
      /* manifest ilegível: o widget não aparece */
    }
  }
  return out;
}

/** Só o que é fonte da verdade vai pro disco: a collection é derivada a cada leitura. */
function toDisk(l: Layout) {
  const { collection: _c, ...rest } = l;
  return rest;
}

function withDerived(l: Layout): Layout {
  return { ...l, collection: scanCollection() };
}

export function loadLayout(): Layout {
  const raw = readJson<(OldLayout & { rev?: number }) | null>(P.layout, null);
  if (raw && raw.rev === LAYOUT_REV) return guarded(withDerived(raw as unknown as Layout));
  if (raw) {
    mkdirSync(P.backups, { recursive: true });
    writeJson(join(P.backups, `layout-rev${raw.rev ?? 0}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), raw);
  }
  const fresh = migrateLayout(raw, versionsOnDisk);
  writeJson(P.layout, toDisk(fresh));
  return guarded(withDerived(fresh));
}

function guarded(l: Layout): Layout {
  try {
    checkImmutability(l);
  } catch {
    /* a guarda é aviso: nunca impede o layout de carregar */
  }
  return l;
}

function save(l: Layout) {
  writeJson(P.layout, toDisk(l));
  publish("layout", l);
}

/** Mutação de layout: carrega, aplica, grava + publica `layout`, registra em decisions.jsonl. */
export function mutateLayout<T>(kind: string, fn: (l: Layout) => { result: T; detail?: Record<string, unknown> }): T {
  const l = loadLayout();
  const { result, detail } = fn(l);
  save(l);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind, ...detail }]);
  return result;
}

// ------------------------------------------------------------ páginas, slots e coleção
// Funções puras sobre o objeto layout (mutam o objeto recebido; sem disco). Erros em português.

type Size = { w: SlotSpec["w"]; h: SlotSpec["h"] };

const gridPage = (l: Layout, id: string): PageDef => {
  const p = l.pages.find((x) => x.id === id);
  if (!p) throw new Error("página não encontrada");
  if (p.kind !== "grid") throw new Error("só páginas de grade recebem widgets");
  return p;
};
const endOrder = (l: Layout, page: string) => Math.max(0, ...l.slots.filter((s) => s.page === page).map((s) => s.order)) + 10;
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

function slugify(title: string): string {
  const base = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "pagina";
}

export function createPage(l: Layout, input: { title: string; icon: string }): PageDef {
  if (!(ICON_NAMES as readonly string[]).includes(input.icon)) throw new Error("ícone inválido");
  const base = slugify(input.title);
  let id = base === "order" ? "order-2" : base;
  for (let n = 2; l.pages.some((p) => p.id === id); n++) id = `${base}-${n}`;
  const page: PageDef = { id, title: input.title.trim(), icon: input.icon, order: Math.max(0, ...l.pages.map((p) => p.order)) + 10, kind: "grid", menu: true, fixed: false };
  l.pages.push(page);
  return page;
}

export function updatePage(l: Layout, id: string, patch: { title?: string; icon?: string; menu?: boolean }): PageDef {
  const p = l.pages.find((x) => x.id === id);
  if (!p) throw new Error("página não encontrada");
  if (patch.icon !== undefined && !(ICON_NAMES as readonly string[]).includes(patch.icon)) throw new Error("ícone inválido");
  if (patch.title !== undefined) p.title = patch.title.trim();
  if (patch.icon !== undefined) p.icon = patch.icon;
  if (patch.menu !== undefined) p.menu = patch.menu;
  return p;
}

export function deletePage(l: Layout, id: string): number {
  const p = l.pages.find((x) => x.id === id);
  if (!p) throw new Error("página não encontrada");
  if (p.fixed) throw new Error("esta página é fixa e não pode ser apagada");
  const before = l.slots.length;
  l.slots = l.slots.filter((s) => s.page !== id);
  l.pages = l.pages.filter((x) => x.id !== id);
  return before - l.slots.length;
}

export function reorderPages(l: Layout, ids: string[]) {
  if (!sameSet(ids, l.pages.map((p) => p.id))) throw new Error("a lista precisa conter exatamente todas as páginas");
  ids.forEach((id, i) => (l.pages.find((p) => p.id === id)!.order = (i + 1) * 10));
  l.pages.sort((a, b) => a.order - b.order);
}

function activeVersion(l: Layout, meta: WidgetMeta): number {
  if (meta.source === "builtin") return 0;
  const v = l.versions[meta.id]?.find((x) => x.status === "active")?.v ?? l.history[meta.id]?.at(-1);
  if (v == null) throw new Error("o widget ainda não tem versão ativa");
  return v;
}

export function addSlot(l: Layout, pageId: string, input: { widget: string; w?: SlotSpec["w"]; h?: SlotSpec["h"] }): SlotSpec {
  gridPage(l, pageId);
  const meta = l.collection.find((m) => m.id === input.widget);
  if (!meta) throw new Error("widget fora da coleção");
  const base = `${pageId}-${meta.id}`;
  let id = base;
  for (let n = 2; l.slots.some((s) => s.id === id); n++) id = `${base}-${n}`;
  const slot: SlotSpec = { id, widget: meta.id, version: activeVersion(l, meta), page: pageId, order: endOrder(l, pageId), w: input.w ?? meta.size.w, h: input.h ?? meta.size.h };
  l.slots.push(slot);
  return slot;
}

export function updateSlot(l: Layout, id: string, patch: Partial<Size> & { page?: string; title?: string }): SlotSpec {
  const s = l.slots.find((x) => x.id === id);
  if (!s) throw new Error("slot não encontrado");
  if (patch.w !== undefined) s.w = patch.w;
  if (patch.h !== undefined) s.h = patch.h;
  if (patch.title !== undefined) {
    if (patch.title.trim()) s.title = patch.title.trim();
    else delete s.title;
  }
  if (patch.page !== undefined && patch.page !== s.page) {
    gridPage(l, patch.page);
    s.page = patch.page;
    s.order = endOrder(l, patch.page);
  }
  return s;
}

export function deleteSlot(l: Layout, id: string) {
  if (!l.slots.some((s) => s.id === id)) throw new Error("slot não encontrado");
  l.slots = l.slots.filter((s) => s.id !== id);
}

export function reorderSlots(l: Layout, pageId: string, ids: string[]) {
  if (!l.pages.some((p) => p.id === pageId)) throw new Error("página não encontrada");
  if (!sameSet(ids, l.slots.filter((s) => s.page === pageId).map((s) => s.id))) throw new Error("a lista precisa conter exatamente os slots da página");
  ids.forEach((id, i) => (l.slots.find((s) => s.id === id)!.order = (i + 1) * 10));
}

function setVersion(l: Layout, widget: string, v: number, patch: Partial<WidgetVersion>) {
  const list = (l.versions[widget] ??= []);
  const cur = list.find((x) => x.v === v);
  if (cur) Object.assign(cur, patch);
  else list.push({ v, status: "checking", at: new Date().toISOString(), note: "", ...patch });
}

function typecheck(file: string): Promise<{ ok: boolean; output: string }> {
  const cfgDir = join(APP_ROOT, "..", "..", "..", ".tmp", "llm-monitor", "tsc");
  mkdirSync(cfgDir, { recursive: true });
  const cfg = join(cfgDir, `tsconfig.widget-${Date.now()}.json`);
  writeFileSync(cfg, JSON.stringify({ extends: join(APP_ROOT, "tsconfig.json"), compilerOptions: { noEmit: true, typeRoots: [join(APP_ROOT, "node_modules", "@types"), join(APP_ROOT, "node_modules")] }, files: [file, join(APP_ROOT, "src", "env.d.ts")], include: [] }));
  return new Promise((resolve) => {
    const tsc = join(APP_ROOT, "node_modules", "typescript", "bin", "tsc");
    const child = spawn(process.execPath, [tsc, "-p", cfg], { cwd: APP_ROOT, windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      // O tsconfig temporário mora fora do app; sem typeRoots explícito (acima) o tsc
      // não achava node/vite-client, abortava antes da checagem semântica e o filtro
      // "só erros do widget" aprovava tudo. Agora tsc falhou = reprovado, sempre.
      const own = out.split("\n").filter((l) => l.includes(`widgets`) && l.includes("error TS"));
      resolve({ ok: code === 0, output: own.join("\n") || (code === 0 ? "" : out.slice(0, 2000)) });
    });
  });
}

const pendingTests = new Map<string, { widget: string; v: number; timer: NodeJS.Timeout }>();

/** Propõe uma versão nova de um widget. Devolve a versão criada. */
export async function proposeWidget(widget: string, code: string, note: string, by: string): Promise<{ v: number; status: string; error?: string }> {
  if (!/^[a-z0-9-]+$/.test(widget)) throw new Error("id de widget inválido");
  const l = loadLayout();
  if (!l.collection.some((m) => m.id === widget)) throw new Error("widget não está na coleção (falta o manifest.json)");
  const vs = versionsOnDisk(widget);
  const v = (vs[vs.length - 1] ?? 0) + 1;
  const file = join(WIDGETS_DIR, widget, `v${v}.tsx`);
  mkdirSync(join(WIDGETS_DIR, widget), { recursive: true });
  writeFileSync(file, code, "utf8");
  recordFingerprint(widget, v);
  setVersion(l, widget, v, { status: "checking", note: `${note} (${by})`, at: new Date().toISOString() });
  save(l);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind: "widget-proposed", widget, v, by, note }]);

  const tc = await typecheck(file);
  const l2 = loadLayout();
  if (!tc.ok) {
    setVersion(l2, widget, v, { status: "failed", error: `Typecheck: ${tc.output}` });
    save(l2);
    return { v, status: "failed", error: tc.output };
  }
  if (clientCount() === 0) {
    setVersion(l2, widget, v, { status: "testing", error: "aguardando um navegador aberto para o render de teste" });
    save(l2);
  } else {
    setVersion(l2, widget, v, { status: "testing", error: undefined });
    save(l2);
  }
  requestTest(widget, v);
  return { v, status: "testing" };
}

function requestTest(widget: string, v: number) {
  const key = `${widget}@${v}`;
  const old = pendingTests.get(key);
  if (old) clearTimeout(old.timer);
  // reemite a cada 10 s até algum navegador responder
  const timer = setInterval(() => publish("widget-test", { widget, v }), 10_000);
  pendingTests.set(key, { widget, v, timer });
  publish("widget-test", { widget, v });
}

/** Reenvia pedidos de teste pendentes (cliente que acabou de conectar). */
export function pendingTestList() {
  return [...pendingTests.values()].map(({ widget, v }) => ({ widget, v }));
}

export function reportTest(widget: string, v: number, ok: boolean, error?: string) {
  const key = `${widget}@${v}`;
  const p = pendingTests.get(key);
  if (!p) return { applied: false, reason: "nenhum teste pendente para esta versão" };
  clearInterval(p.timer);
  pendingTests.delete(key);
  const l = loadLayout();
  if (!ok) {
    const msg = `Render de teste: ${error ?? "falhou"}`;
    setVersion(l, widget, v, { status: "failed", error: msg });
    save(l);
    settleGate(key, { v, status: "failed", error: msg });
    return { applied: false };
  }
  activateVersion(l, widget, v);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind: "widget-swapped", widget, v }]);
  settleGate(key, { v, status: "active" });
  return { applied: true };
}

function activateVersion(l: Layout, widget: string, v: number) {
  for (const x of l.versions[widget] ?? []) if (x.status === "active") x.status = "retired";
  setVersion(l, widget, v, { status: "active", error: undefined, at: new Date().toISOString() });
  for (const s of l.slots) if (s.widget === widget) s.version = v;
  (l.history[widget] ??= []).push(v);
  save(l);
}

/** Desfazer: volta para a versão ativa anterior (a nova fica guardada). */
export function undoWidget(widget: string) {
  const l = loadLayout();
  const h = l.history[widget] ?? [];
  if (h.length < 2) throw new Error("não há versão anterior para voltar");
  h.pop();
  const prev = h[h.length - 1];
  for (const x of l.versions[widget] ?? []) if (x.status === "active") x.status = "retired";
  setVersion(l, widget, prev, { status: "active" });
  for (const s of l.slots) if (s.widget === widget) s.version = prev;
  save(l);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind: "widget-undo", widget, v: prev }]);
  return prev;
}

/** Ativar uma versão guardada qualquer (já validada antes). */
export function restoreWidget(widget: string, v: number) {
  const l = loadLayout();
  const ver = l.versions[widget]?.find((x) => x.v === v);
  if (!ver || ver.status === "failed" || ver.status === "checking") throw new Error("versão não validada");
  activateVersion(l, widget, v);
}

// ------------------------------------------------------------ guarda de imutabilidade
// Versão publicada é imutável. Ao publicar, o disco guarda tamanho + mtime + sha256 de cada
// versão; ao carregar o layout, versão ativa cujo conteúdo mudou levanta um aviso (flags.ts).
// Não bloqueia: só deixa a edição no lugar visível.

const FINGERPRINTS = join(STATE, "widget-fingerprints.json");
type Fingerprint = { size: number; mtimeMs: number; sha256: string };
const sha256Of = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const warned = new Set<string>();

export function recordFingerprint(widget: string, v: number, dir: string = WIDGETS_DIR, store: string = FINGERPRINTS) {
  const file = join(dir, widget, `v${v}.tsx`);
  const st = statSync(file);
  const all = readJson<Record<string, Fingerprint>>(store, {});
  all[`${widget}@${v}`] = { size: st.size, mtimeMs: st.mtimeMs, sha256: sha256Of(file) };
  writeJson(store, all);
}

/** Confere as versões ativas (do layout e dos slots) contra o registro. Devolve as chaves `widget@v` editadas no lugar. */
export function checkImmutability(l: Layout, dir: string = WIDGETS_DIR, store: string = FINGERPRINTS): string[] {
  const active = new Set<string>();
  for (const [w, list] of Object.entries(l.versions)) for (const x of list) if (x.status === "active") active.add(`${w}@${x.v}`);
  for (const s of l.slots) if (s.version > 0) active.add(`${s.widget}@${s.version}`);
  const all = readJson<Record<string, Fingerprint>>(store, {});
  const edited: string[] = [];
  let dirty = false;
  for (const key of active) {
    const [w, v] = key.split("@");
    const file = join(dir, w, `v${v}.tsx`);
    if (!existsSync(file)) continue;
    const st = statSync(file);
    const fp = all[key];
    if (!fp || (fp.size === st.size && fp.mtimeMs === st.mtimeMs)) {
      if (!fp) {
        all[key] = { size: st.size, mtimeMs: st.mtimeMs, sha256: sha256Of(file) }; // primeira vez que a versão é vista: vira a referência
        dirty = true;
      }
      clearFlag(`widget-edited:${key}`);
      continue;
    }
    const sha = sha256Of(file);
    if (sha === fp.sha256) {
      all[key] = { ...fp, size: st.size, mtimeMs: st.mtimeMs }; // só tocado, conteúdo igual
      dirty = true;
      clearFlag(`widget-edited:${key}`);
      continue;
    }
    edited.push(key);
    if (!warned.has(`${key}:${sha}`)) {
      warned.add(`${key}:${sha}`);
      raiseFlag({
        key: `widget-edited:${key}`,
        kind: "widget-edited-in-place",
        level: "warning",
        title: `versão ativa editada no lugar: ${w} v${v}`,
        detail: `widgets/${w}/v${v}.tsx mudou depois de publicado. Versão publicada é imutável: grave a mudança como versão nova.`,
      });
    }
  }
  if (dirty) writeJson(store, all);
  return edited;
}

// ------------------------------------------------------------ chat cria e modifica widgets

export type PublishOutcome = { v: number; status: "active" | "testing" | "failed"; error?: string };
export type WidgetDeps = {
  widgetsDir: string;
  /** pasta dos rascunhos; caminhos relativos são resolvidos a partir da pasta-mãe (state/agent-work) */
  draftsDir: string;
  /** versão nova pelo portão (typecheck + render de teste) */
  publish: (widget: string, code: string, note: string, by: string) => Promise<PublishOutcome>;
  /** desfaz um widget que o portão reprovou */
  discard: (widget: string) => void;
};

export const GATE_TIMEOUT_MS = 30_000;
export const NO_BROWSER_MSG = "Typecheck passou, mas nenhum navegador com o monitor aberto pode fazer o render de teste. Abra o monitor no navegador: a versão fica em teste e entra sozinha quando o navegador abrir.";
const timeoutMsg = (ms: number) => `Typecheck passou, mas o navegador não respondeu ao render de teste em ${Math.round(ms / 1000)} s. A versão fica em teste e entra sozinha quando o navegador responder; confira no painel "Versões".`;

const gateWaiters = new Map<string, (o: PublishOutcome) => void>();
function settleGate(key: string, o: PublishOutcome) {
  gateWaiters.get(key)?.(o);
  gateWaiters.delete(key);
}

/** proposeWidget + espera pelo resultado do render de teste (com tempo limite; sem navegador, responde na hora). */
export async function publishThroughGate(widget: string, code: string, note: string, by: string, timeoutMs = GATE_TIMEOUT_MS): Promise<PublishOutcome> {
  const r = await proposeWidget(widget, code, note, by);
  if (r.status === "failed") return { v: r.v, status: "failed", error: `Typecheck: ${r.error}` };
  if (clientCount() === 0) return { v: r.v, status: "testing", error: NO_BROWSER_MSG };
  const key = `${widget}@${r.v}`;
  return new Promise((done) => {
    const timer = setTimeout(() => {
      gateWaiters.delete(key);
      done({ v: r.v, status: "testing", error: timeoutMsg(timeoutMs) });
    }, timeoutMs);
    gateWaiters.set(key, (o) => {
      clearTimeout(timer);
      done(o);
    });
  });
}

/** Apaga os arquivos do widget (manifest e versões); a pasta só sai se ficar vazia. */
export function removeWidgetFiles(id: string, dir: string = WIDGETS_DIR) {
  const wd = join(dir, id);
  if (!existsSync(wd)) return;
  for (const f of readdirSync(wd)) if (f === "manifest.json" || /^v\d+\.tsx$/.test(f)) unlinkSync(join(wd, f));
  try {
    rmdirSync(wd);
  } catch {
    /* sobrou arquivo alheio: a pasta fica, sem manifest o widget já não aparece na coleção */
  }
}

function discardWidget(id: string) {
  removeWidgetFiles(id);
  const l = loadLayout();
  delete l.versions[id];
  delete l.history[id];
  save(l);
}

const defaultDeps = (): WidgetDeps => ({ widgetsDir: WIDGETS_DIR, draftsDir: join(AGENT_WORK, "drafts"), publish: publishThroughGate, discard: discardWidget });

const WIDGET_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DRAFT = 256 * 1024;

/** Lê o rascunho `.tsx`; só aceita caminho real dentro da pasta de rascunhos. Erros em português. */
export function readDraft(file: string, draftsDir: string): string {
  mkdirSync(draftsDir, { recursive: true });
  const inside = (root: string, p: string) => {
    const rel = relative(root, p);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  const outside = () => new Error(`o rascunho precisa estar dentro de ${draftsDir}`);
  const abs = isAbsolute(file) ? file : resolve(dirname(draftsDir), file);
  if (!inside(draftsDir, abs)) throw outside();
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new Error(`rascunho não encontrado: ${abs}`);
  }
  if (!inside(realpathSync(draftsDir), real)) throw outside();
  if (!real.endsWith(".tsx")) throw new Error("o rascunho precisa ser um arquivo .tsx");
  if (statSync(real).size > MAX_DRAFT) throw new Error("rascunho grande demais (máx. 256 KB)");
  return readFileSync(real, "utf8");
}

function announce(id: string, title: string, o: PublishOutcome) {
  publish("chat", { type: "widget", id, v: o.v, status: o.status, title });
}

export type CreateInput = { id: string; title: string; description?: string; size: WidgetMeta["size"]; file: string };

/** Cria o widget na coleção (manifest + v1) pelo mesmo portão de proposeWidget. Reprovado: nada fica no disco. */
export async function createWidget(input: CreateInput, deps: WidgetDeps = defaultDeps()): Promise<PublishOutcome & { id: string }> {
  const { id } = input;
  const taken = `já existe um widget com o id "${id}"; para mudá-lo, publique uma versão nova`;
  if (!WIDGET_ID.test(id) || id.length > 40) throw new Error("id inválido: use kebab-case (letras minúsculas, números e hífens), até 40 caracteres");
  if (existsSync(join(deps.widgetsDir, id))) throw new Error(taken);
  const code = readDraft(input.file, deps.draftsDir);
  mkdirSync(deps.widgetsDir, { recursive: true });
  try {
    mkdirSync(join(deps.widgetsDir, id)); // sem recursive: dois pedidos simultâneos não criam o mesmo id
  } catch {
    throw new Error(taken);
  }
  const meta: WidgetMeta = { id, title: input.title, description: input.description ?? "", source: "versioned", size: input.size, createdBy: "chat", createdAt: new Date().toISOString() };
  writeFileSync(join(deps.widgetsDir, id, "manifest.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  let outcome: PublishOutcome;
  try {
    outcome = await deps.publish(id, code, "versão inicial", "chat");
  } catch (e) {
    deps.discard(id);
    throw e;
  }
  if (outcome.status === "failed") deps.discard(id);
  announce(id, input.title, outcome);
  return { id, ...outcome };
}

/** Versão seguinte de um widget existente, a partir de um rascunho, pelo mesmo portão. */
export async function addVersionFromFile(id: string, input: { file: string; note?: string }, deps: WidgetDeps = defaultDeps()): Promise<PublishOutcome & { id: string }> {
  if (!WIDGET_ID.test(id)) throw new Error("id de widget inválido");
  const meta = scanCollection(deps.widgetsDir).find((m) => m.id === id);
  if (!meta) throw new Error("widget não está na coleção");
  if (meta.source !== "versioned") throw new Error("este widget é embutido no código e não tem versões");
  const code = readDraft(input.file, deps.draftsDir);
  const outcome = await deps.publish(id, code, input.note?.trim() || "versão do chat", "chat");
  announce(id, meta.title, outcome);
  return { id, ...outcome };
}

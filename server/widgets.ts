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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, P, WIDGETS_DIR, appendJsonl, readJson, writeJson } from "./store.ts";
import { publish, clientCount } from "./bus.ts";
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
  if (raw && raw.rev === LAYOUT_REV) return withDerived(raw as unknown as Layout);
  if (raw) {
    mkdirSync(P.backups, { recursive: true });
    writeJson(join(P.backups, `layout-rev${raw.rev ?? 0}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), raw);
  }
  const fresh = migrateLayout(raw, versionsOnDisk);
  writeJson(P.layout, toDisk(fresh));
  return withDerived(fresh);
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
    setVersion(l, widget, v, { status: "failed", error: `Render de teste: ${error ?? "falhou"}` });
    save(l);
    return { applied: false };
  }
  activateVersion(l, widget, v);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind: "widget-swapped", widget, v }]);
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

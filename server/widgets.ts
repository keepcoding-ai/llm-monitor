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
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, P, WIDGETS_DIR, appendJsonl, readJson, writeJson } from "./store.ts";
import { publish, clientCount } from "./bus.ts";
import type { Layout, SlotSpec, WidgetVersion } from "../shared/snapshot.ts";

const DEFAULT_SLOTS: Omit<SlotSpec, "version">[] = [
  { id: "autonomia", widget: "autonomia", title: "Autonomia", span: { md: 2, xl: 2, tv: 2 } },
  { id: "limites", widget: "limites", title: "Limites do plano", span: { md: 1, xl: 1, tv: 1 } },
  { id: "consumo", widget: "consumo", title: "Consumo no tempo", span: { md: 2, xl: 2, tv: 2 } },
  { id: "sugestoes", widget: "sugestoes", title: "Sugestões", span: { md: 1, xl: 1, tv: 1 } },
  { id: "por-modelo", widget: "por-modelo", title: "Por modelo", span: { md: 1, xl: 1, tv: 1 } },
  { id: "picos", widget: "picos", title: "Picos", span: { md: 1, xl: 2, tv: 2 } },
  { id: "contas-soul", widget: "contas-soul", title: "Contas Soul", span: { md: 1, xl: 1, tv: 1 } },
  { id: "controle", widget: "controle", title: "Controle", span: { md: 1, xl: 1, tv: 1 } },
  { id: "marcas", widget: "marcas", title: "Marcas", span: { md: 1, xl: 1, tv: 1 } },
  { id: "chat", widget: "chat", title: "Chat", span: { md: 2, xl: 3, tv: 2 } },
];

function versionsOnDisk(id: string): number[] {
  const dir = join(WIDGETS_DIR, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^v(\d+)\.tsx$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
}

export function loadLayout(): Layout {
  const l = readJson<Layout | null>(P.layout, null);
  if (l) return l;
  const now = new Date().toISOString();
  const fresh: Layout = { slots: [], versions: {}, history: {} };
  for (const s of DEFAULT_SLOTS) {
    const vs = versionsOnDisk(s.widget);
    if (vs.length === 0) continue;
    fresh.slots.push({ ...s, version: vs[vs.length - 1] });
    fresh.versions[s.widget] = vs.map((v) => ({ v, status: v === vs[vs.length - 1] ? "active" : "retired", at: now, note: "versão inicial" }));
    fresh.history[s.widget] = [vs[vs.length - 1]];
  }
  writeJson(P.layout, fresh);
  return fresh;
}

function save(l: Layout) {
  writeJson(P.layout, l);
  publish("layout", l);
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
  if (!l.slots.some((s) => s.widget === widget)) throw new Error("widget não está em nenhum slot");
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

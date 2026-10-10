import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { subscribe } from "./bus.ts";
import { listFlags } from "./flags.ts";
import type { Layout } from "../shared/snapshot.ts";
import { addVersionFromFile, checkImmutability, createWidget, readDraft, recordFingerprint, removeWidgetFiles, scanCollection, type PublishOutcome, type WidgetDeps } from "./widgets.ts";

const CODE = "export default function W() { return null; }\n";

/** Pasta temporária com widgets/ e drafts/ próprios; `publish` falso grava v1 e devolve o resultado dado. */
function rig(outcome: PublishOutcome = { v: 1, status: "active" }) {
  const root = mkdtempSync(join(tmpdir(), "widget-create-"));
  const widgetsDir = join(root, "widgets");
  const draftsDir = join(root, "agent-work", "drafts");
  mkdirSync(widgetsDir, { recursive: true });
  mkdirSync(draftsDir, { recursive: true });
  const calls: string[] = [];
  const deps: WidgetDeps = {
    widgetsDir,
    draftsDir,
    publish: async (widget, code, note, by) => {
      calls.push(`${widget}|${note}|${by}`);
      writeFileSync(join(widgetsDir, widget, `v${outcome.v}.tsx`), code);
      return outcome;
    },
    discard: (id) => removeWidgetFiles(id, widgetsDir),
  };
  const draft = (name = "novo.tsx", code = CODE) => {
    const f = join(draftsDir, name);
    writeFileSync(f, code);
    return f;
  };
  return { root, widgetsDir, draftsDir, deps, calls, draft };
}

const input = (file: string, over: Partial<Parameters<typeof createWidget>[0]> = {}) => ({ id: "novo", title: "Novo", description: "d", size: { w: 1 as const, h: 1 as const }, file, ...over });

test("id fora de kebab-case é recusado", async () => {
  const r = rig();
  const file = r.draft();
  for (const id of ["Novo", "novo_x", "../x", "a--b", "-a", "a b", ""]) await assert.rejects(createWidget(input(file, { id }), r.deps), /id inválido/, id);
  assert.equal(r.calls.length, 0);
});

test("id repetido é recusado e o widget existente fica intacto", async () => {
  const r = rig();
  const file = r.draft();
  mkdirSync(join(r.widgetsDir, "janelas"));
  writeFileSync(join(r.widgetsDir, "janelas", "marca.txt"), "x");
  await assert.rejects(createWidget(input(file, { id: "janelas" }), r.deps), /já existe/);
  assert.ok(existsSync(join(r.widgetsDir, "janelas", "marca.txt")));
  assert.equal(r.calls.length, 0);
});

test("arquivo fora de drafts é recusado (absoluto, relativo com .., irmão de prefixo parecido, inexistente, não .tsx)", async () => {
  const r = rig();
  const fora = join(r.root, "fora.tsx");
  writeFileSync(fora, CODE);
  const irmao = join(r.root, "agent-work", "drafts-extra");
  mkdirSync(irmao);
  writeFileSync(join(irmao, "x.tsx"), CODE);
  for (const file of [fora, "../fora.tsx", "drafts/../../fora.tsx", join(irmao, "x.tsx"), r.draftsDir]) await assert.rejects(createWidget(input(file), r.deps), /dentro de/, file);
  await assert.rejects(createWidget(input(join(r.draftsDir, "nao-existe.tsx")), r.deps), /não encontrado/);
  await assert.rejects(createWidget(input(r.draft("a.txt")), r.deps), /\.tsx/);
  assert.equal(existsSync(join(r.widgetsDir, "novo")), false, "nada foi criado");
  assert.equal(r.calls.length, 0);
});

test("atalho (symlink) de drafts para fora é recusado", (t) => {
  const r = rig();
  const fora = join(r.root, "segredo.tsx");
  writeFileSync(fora, CODE);
  try {
    symlinkSync(fora, join(r.draftsDir, "atalho.tsx"));
  } catch {
    t.skip("sem permissão para criar symlink neste ambiente");
    return;
  }
  assert.throws(() => readDraft(join(r.draftsDir, "atalho.tsx"), r.draftsDir), /dentro de/);
});

test("criação aprovada: manifest do chat, v1 publicada, coleção enxerga, evento no canal do chat", async () => {
  const r = rig();
  const events: unknown[] = [];
  const off = subscribe((e) => e.event === "chat" && events.push(e.data));
  try {
    const out = await createWidget(input(r.draft("novo.tsx"), { size: { w: 2, h: 3 } }), r.deps);
    assert.deepEqual(out, { id: "novo", v: 1, status: "active" });
  } finally {
    off();
  }
  const m = JSON.parse(readFileSync(join(r.widgetsDir, "novo", "manifest.json"), "utf8"));
  assert.equal(m.source, "versioned");
  assert.equal(m.createdBy, "chat");
  assert.ok(!Number.isNaN(Date.parse(m.createdAt)));
  assert.deepEqual(m.size, { w: 2, h: 3 });
  assert.equal(readFileSync(join(r.widgetsDir, "novo", "v1.tsx"), "utf8"), CODE);
  assert.deepEqual(scanCollection(r.widgetsDir).map((x) => [x.id, x.createdBy]), [["novo", "chat"]]);
  assert.deepEqual(events, [{ type: "widget", id: "novo", v: 1, status: "active", title: "Novo" }]);
  assert.deepEqual(r.calls, ["novo|versão inicial|chat"]);
});

test("rascunho relativo (a partir de agent-work) é aceito", async () => {
  const r = rig();
  r.draft("rel.tsx");
  const out = await createWidget(input("drafts/rel.tsx", { id: "rel" }), r.deps);
  assert.equal(out.status, "active");
});

test("portão reprovado desfaz o manifest e devolve o erro do portão", async () => {
  const r = rig({ v: 1, status: "failed", error: "Typecheck: widgets/novo/v1.tsx(3,1): error TS2322" });
  const out = await createWidget(input(r.draft()), r.deps);
  assert.equal(out.status, "failed");
  assert.match(out.error ?? "", /TS2322/);
  assert.equal(existsSync(join(r.widgetsDir, "novo", "manifest.json")), false);
  assert.equal(existsSync(join(r.widgetsDir, "novo")), false);
  assert.deepEqual(scanCollection(r.widgetsDir), []);
  // o mesmo id volta a ficar livre para a correção
  r.deps.publish = async (w, c) => (writeFileSync(join(r.widgetsDir, w, "v1.tsx"), c), { v: 1, status: "active" });
  assert.equal((await createWidget(input(r.draft()), r.deps)).status, "active");
});

test("portão que lança também desfaz o manifest", async () => {
  const r = rig();
  r.deps.publish = async () => {
    throw new Error("boom");
  };
  await assert.rejects(createWidget(input(r.draft()), r.deps), /boom/);
  assert.equal(existsSync(join(r.widgetsDir, "novo")), false);
});

test("render de teste pendente (testing) mantém o widget na coleção", async () => {
  const r = rig({ v: 1, status: "testing", error: "nenhum navegador" });
  const out = await createWidget(input(r.draft()), r.deps);
  assert.equal(out.status, "testing");
  assert.equal(scanCollection(r.widgetsDir).length, 1);
});

test("nova versão a partir de arquivo: widget inexistente, embutido e fora de drafts são recusados; válido publica", async () => {
  const r = rig({ v: 2, status: "active" });
  const file = r.draft("mudou.tsx");
  await assert.rejects(addVersionFromFile("fantasma", { file, note: "" }, r.deps), /não está na coleção/);
  mkdirSync(join(r.widgetsDir, "cabe"));
  writeFileSync(join(r.widgetsDir, "cabe", "manifest.json"), JSON.stringify({ id: "cabe", title: "Cabe", source: "builtin", size: { w: 1, h: 1 } }));
  await assert.rejects(addVersionFromFile("cabe", { file, note: "" }, r.deps), /embutido/);
  await createWidget(input(r.draft()), { ...r.deps, publish: async (w, c) => (writeFileSync(join(r.widgetsDir, w, "v1.tsx"), c), { v: 1, status: "active" }) });
  await assert.rejects(addVersionFromFile("novo", { file: join(r.root, "x.tsx"), note: "" }, r.deps), /dentro de/);
  const events: unknown[] = [];
  const off = subscribe((e) => e.event === "chat" && events.push(e.data));
  try {
    assert.deepEqual(await addVersionFromFile("novo", { file, note: "ajuste" }, r.deps), { id: "novo", v: 2, status: "active" });
  } finally {
    off();
  }
  assert.deepEqual(events, [{ type: "widget", id: "novo", v: 2, status: "active", title: "Novo" }]);
  assert.ok(r.calls.at(-1)?.startsWith("novo|ajuste|chat"));
});

test("guarda de imutabilidade: versão ativa editada no lugar levanta aviso e não bloqueia", () => {
  const r = rig();
  const store = join(r.root, "fingerprints.json");
  mkdirSync(join(r.widgetsDir, "w"));
  const file = join(r.widgetsDir, "w", "v1.tsx");
  writeFileSync(file, CODE);
  recordFingerprint("w", 1, r.widgetsDir, store);
  const layout = { rev: 5, pages: [], slots: [], collection: [], versions: { w: [{ v: 1, status: "active", at: "", note: "" }] }, history: {} } as Layout;

  assert.deepEqual(checkImmutability(layout, r.widgetsDir, store), [], "intacta: sem aviso");

  const later = new Date(Date.now() + 5000);
  utimesSync(file, later, later);
  assert.deepEqual(checkImmutability(layout, r.widgetsDir, store), [], "só tocada (mesmo conteúdo): sem aviso");

  writeFileSync(file, CODE + "// editado no lugar\n");
  assert.deepEqual(checkImmutability(layout, r.widgetsDir, store), ["w@1"]);
  const flag = listFlags().find((f) => f.key === "widget-edited:w@1");
  assert.ok(flag, "aviso levantado");
  assert.equal(flag!.title, "versão ativa editada no lugar: w v1");
  assert.equal(flag!.level, "warning");
});

test("guarda: versão sem registro vira a referência e versão aposentada não é conferida", () => {
  const r = rig();
  const store = join(r.root, "fingerprints.json");
  mkdirSync(join(r.widgetsDir, "w"));
  writeFileSync(join(r.widgetsDir, "w", "v1.tsx"), CODE);
  writeFileSync(join(r.widgetsDir, "w", "v2.tsx"), CODE);
  const layout = { rev: 5, pages: [], slots: [], collection: [], versions: { w: [{ v: 1, status: "retired", at: "", note: "" }, { v: 2, status: "active", at: "", note: "" }] }, history: {} } as Layout;
  assert.deepEqual(checkImmutability(layout, r.widgetsDir, store), []);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(store, "utf8"))), ["w@2"]);
  writeFileSync(join(r.widgetsDir, "w", "v1.tsx"), CODE + "// mexida\n");
  assert.deepEqual(checkImmutability(layout, r.widgetsDir, store), []);
});

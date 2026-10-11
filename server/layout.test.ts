import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ICON_NAMES, type SlotH } from "../shared/snapshot.ts";
import { addSlot, createPage, deletePage, deleteSlot, migrateLayout, reorderPages, reorderSlots, scanCollection, updatePage, updateSlot } from "./widgets.ts";

// Cópia de state/layout.json na rev 4 (antes da migração)
const rev4 = JSON.parse(readFileSync(new URL("./fixtures/layout-rev4.json", import.meta.url), "utf8"));
const disk: Record<string, number[]> = { "semana-ritmo": [1], "o-que-comeu": [1], janelas: [1], reserva: [1], avisos: [1], "reserva-linha": [1], "por-que": [1, 2, 3] };
const onDisk = (w: string) => disk[w] ?? [];
const NOW = "2026-10-10T12:00:00.000Z";

test("rev 4 -> rev atual preserva versions e history", () => {
  const before = JSON.stringify(rev4);
  const l = migrateLayout(rev4, onDisk, NOW);
  assert.equal(JSON.stringify(rev4), before, "pura: não muta a entrada");
  assert.equal(l.rev, 6);
  assert.deepEqual(l.versions, rev4.versions);
  assert.deepEqual(l.history, rev4.history);
});

test("cria as pages default, com ícones da lista fechada", () => {
  const l = migrateLayout(rev4, onDisk, NOW);
  assert.deepEqual(
    l.pages.map((p) => [p.id, p.title, p.icon, p.kind, p.menu, p.fixed]),
    [
      ["agora", "Agora", "House", "grid", true, true],
      ["ciclo", "Ciclo", "ArrowsClockwise", "grid", true, true],
      ["reserva", "Reserva", "Lifebuoy", "single", true, true],
      ["ajustes", "Ajustes", "GearSix", "settings", true, true],
      ["avisos", "Avisos", "Warning", "single", false, true],
    ],
  );
  for (const p of l.pages) assert.ok((ICON_NAMES as readonly string[]).includes(p.icon), p.icon);
});

test("cria os slots default na ordem, com id página-widget e tamanho", () => {
  const l = migrateLayout(rev4, onDisk, NOW);
  const view = (page: string) => l.slots.filter((s) => s.page === page).sort((a, b) => a.order - b.order).map((s) => `${s.id}:${s.w}x${s.h}`);
  assert.deepEqual(view("agora"), ["agora-veredito:2x1", "agora-cabe:1x1", "agora-semana-ritmo:1x2", "agora-o-que-comeu:1x4", "agora-janelas:1x4"]);
  assert.deepEqual(view("ciclo"), ["ciclo-semana-ritmo:3x2", "ciclo-o-que-comeu:2x4", "ciclo-janelas:1x4"]);
  assert.equal(view("reserva").length, 1);
  assert.equal(view("avisos").length, 1);
});

test("versão ativa de cada widget é mantida (nem rebaixa, nem avança)", () => {
  const withNewer = structuredClone(rev4);
  withNewer.slots.find((s: { widget: string }) => s.widget === "janelas").version = 1;
  const l = migrateLayout(withNewer, (w) => (w === "janelas" ? [1, 2] : onDisk(w)), NOW);
  for (const s of l.slots.filter((x) => x.widget !== "veredito" && x.widget !== "cabe")) {
    const old = rev4.slots.find((o: { widget: string }) => o.widget === s.widget);
    assert.equal(s.version, old.version, s.id);
  }
  // v2 existe em disco mas não é ativada
  assert.equal(l.versions.janelas.find((x) => x.v === 2)?.status, "retired");
  assert.equal(l.slots.find((s) => s.id === "ciclo-janelas")?.version, 1);
});

// Cópia de state/layout.json do dono na rev 5 (linha = célula quadrada), tirada antes da migração
const rev5 = JSON.parse(readFileSync(new URL("./fixtures/layout-rev5.json", import.meta.url), "utf8"));

test("rev 5 -> rev 6 só dobra o h: páginas, slots, ordem, versões e histórico do dono intactos", () => {
  const before = JSON.stringify(rev5);
  const l = migrateLayout(rev5, () => assert.fail("a rev 5 não relê o disco"), NOW);
  assert.equal(JSON.stringify(rev5), before, "pura: não muta a entrada");
  assert.equal(l.rev, 6);
  assert.deepEqual(l.pages, rev5.pages);
  assert.deepEqual(l.versions, rev5.versions);
  assert.deepEqual(l.history, rev5.history);
  assert.equal(l.slots.length, rev5.slots.length);
  l.slots.forEach((s, i) => {
    const { h, ...rest } = s;
    const { h: oldH, ...oldRest } = rev5.slots[i];
    assert.deepEqual(rest, oldRest, s.id);
    assert.equal(h, oldH * 2, s.id);
  });
  // layout personalizado sobrevive: slot extra, título próprio, ordem trocada e h no teto
  const custom = structuredClone(rev5);
  custom.pages.push({ id: "minha", title: "Minha", icon: "Star", order: 60, kind: "grid", menu: true, fixed: false });
  custom.slots.push({ id: "minha-janelas", widget: "janelas", version: 1, page: "minha", order: 10, w: 3, h: 4, title: "Minhas janelas" });
  const c = migrateLayout(custom, onDisk, NOW);
  assert.deepEqual(c.pages.at(-1), custom.pages.at(-1));
  assert.deepEqual(c.slots.at(-1), { ...custom.slots.at(-1), h: 8 });
  // migrar de novo não dobra outra vez: a rev 6 não passa mais por aqui (loadLayout devolve como está)
  assert.equal(c.rev, 6);
});

test("sem layout anterior, nasce do disco", () => {
  const l = migrateLayout(null, onDisk, NOW);
  assert.equal(l.slots.find((s) => s.id === "reserva-reserva")?.version, 1);
  assert.deepEqual(l.history.reserva, [1]);
});

test("coleção vem dos manifests; widget sem manifest fica invisível", () => {
  const real = scanCollection();
  const bySrc = (src: string) => real.filter((m) => m.source === src).map((m) => m.id).sort();
  for (const id of ["avisos", "janelas", "o-que-comeu", "reserva", "reserva-linha", "semana-ritmo"]) assert.ok(bySrc("versioned").includes(id), id);
  for (const id of ["cabe", "veredito"]) assert.ok(bySrc("builtin").includes(id), id);
  assert.ok(!real.some((m) => m.id === "chat"), "chat não tem manifest");

  const tmp = mkdtempSync(join(tmpdir(), "coll-"));
  mkdirSync(join(tmp, "sem-manifest"));
  mkdirSync(join(tmp, "quebrado"));
  mkdirSync(join(tmp, "ok"));
  writeFileSync(join(tmp, "quebrado", "manifest.json"), "{ não é json");
  writeFileSync(join(tmp, "ok", "manifest.json"), JSON.stringify({ id: "ok", title: "Ok", description: "d", source: "versioned", size: { w: 1, h: 1 }, createdBy: "chat", createdAt: NOW }));
  assert.deepEqual(scanCollection(tmp).map((m) => m.id), ["ok"]);
});

// ------------------------------------------------------------ S3: páginas, slots, coleção

const meta = (id: string, source: "versioned" | "builtin", w: 1 | 2 | 3 = 1, h: SlotH = 1) => ({ id, title: id, description: "", source, size: { w, h }, createdBy: "system" as const, createdAt: NOW });
function fixture() {
  const l = migrateLayout(rev4, onDisk, NOW);
  l.collection = [meta("janelas", "versioned", 1, 2), meta("cabe", "builtin", 2, 1), meta("sem-versao", "versioned")];
  return l;
}

test("criar página: slug único, grid, menu, no fim; ícone fora da lista é recusado", () => {
  const l = fixture();
  const p = createPage(l, { title: "Visão Geral", icon: "Star" });
  assert.deepEqual([p.id, p.kind, p.menu, p.fixed, p.order], ["visao-geral", "grid", true, false, 60]);
  assert.equal(createPage(l, { title: "visão geral", icon: "Star" }).id, "visao-geral-2");
  assert.equal(createPage(l, { title: "Order", icon: "Star" }).id, "order-2");
  assert.throws(() => createPage(l, { title: "X", icon: "Nope" }), /ícone/);
});

test("editar página", () => {
  const l = fixture();
  const p = createPage(l, { title: "A", icon: "Star" });
  updatePage(l, p.id, { title: " B ", icon: "Gauge", menu: false });
  assert.deepEqual([p.title, p.icon, p.menu], ["B", "Gauge", false]);
  assert.throws(() => updatePage(l, "nada", {}), /não encontrada/);
});

test("adicionar slot: tamanho do manifest, versão ativa, id repetido ganha sufixo, entra no fim", () => {
  const l = fixture();
  const a = addSlot(l, "agora", { widget: "janelas" });
  assert.deepEqual([a.id, a.w, a.h, a.version], ["agora-janelas-2", 1, 2, 1]);
  assert.ok(a.order > Math.max(...l.slots.filter((s) => s.page === "agora" && s !== a).map((s) => s.order)));
  const b = addSlot(l, "agora", { widget: "janelas", w: 3, h: 1 });
  assert.deepEqual([b.id, b.w, b.h], ["agora-janelas-3", 3, 1]);
  assert.equal(addSlot(l, "agora", { widget: "cabe" }).version, 0);
});

test("adicionar slot: recusa widget fora da coleção, página inexistente ou não-grid", () => {
  const l = fixture();
  assert.throws(() => addSlot(l, "agora", { widget: "chat" }), /fora da coleção/);
  assert.throws(() => addSlot(l, "reserva", { widget: "cabe" }), /grade/);
  assert.throws(() => addSlot(l, "nada", { widget: "cabe" }), /não encontrada/);
  assert.throws(() => addSlot(l, "agora", { widget: "sem-versao" }), /versão ativa/);
});

test("redimensionar e renomear slot", () => {
  const l = fixture();
  const s = updateSlot(l, "agora-janelas", { w: 3, h: 2, title: "Minhas janelas" });
  assert.deepEqual([s.w, s.h, s.title], [3, 2, "Minhas janelas"]);
  updateSlot(l, "agora-janelas", { title: "" });
  assert.equal(s.title, undefined);
});

test("mover slot para outra página grid põe no fim; recusa página não-grid", () => {
  const l = fixture();
  const s = updateSlot(l, "agora-janelas", { page: "ciclo" });
  assert.equal(s.page, "ciclo");
  assert.ok(l.slots.filter((x) => x.page === "ciclo" && x !== s).every((x) => x.order < s.order));
  assert.throws(() => updateSlot(l, "agora-cabe", { page: "ajustes" }), /grade/);
  assert.throws(() => updateSlot(l, "nada", { w: 1 }), /não encontrado/);
});

test("reordenar slots exige o conjunto exato da página", () => {
  const l = fixture();
  const ids = l.slots.filter((s) => s.page === "ciclo").map((s) => s.id).reverse();
  reorderSlots(l, "ciclo", ids);
  assert.deepEqual(l.slots.filter((s) => s.page === "ciclo").sort((a, b) => a.order - b.order).map((s) => s.id), ids);
  assert.throws(() => reorderSlots(l, "ciclo", ids.slice(1)), /exatamente/);
  assert.throws(() => reorderSlots(l, "ciclo", [...ids, "agora-cabe"]), /exatamente/);
  assert.throws(() => reorderSlots(l, "ciclo", [ids[0], ids[0], ids[1]]), /exatamente/);
});

test("reordenar páginas exige o conjunto exato", () => {
  const l = fixture();
  const ids = l.pages.map((p) => p.id).reverse();
  reorderPages(l, ids);
  assert.deepEqual(l.pages.map((p) => p.id), ids);
  assert.throws(() => reorderPages(l, ids.slice(1)), /exatamente/);
});

test("apagar slot; apagar página remove os slots; página fixa é recusada", () => {
  const l = fixture();
  deleteSlot(l, "agora-cabe");
  assert.ok(!l.slots.some((s) => s.id === "agora-cabe"));
  assert.throws(() => deleteSlot(l, "agora-cabe"), /não encontrado/);
  const p = createPage(l, { title: "Nova", icon: "Star" });
  addSlot(l, p.id, { widget: "cabe" });
  assert.equal(deletePage(l, p.id), 1);
  assert.ok(!l.pages.some((x) => x.id === p.id) && !l.slots.some((s) => s.page === p.id));
  const before = l.slots.length;
  assert.throws(() => deletePage(l, "agora"), /fixa/);
  assert.equal(l.slots.length, before);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_WALK_INTERVAL_MS, HOT_WINDOW_MS, commit, newFileIndex, pickChanged, selectHotSet, shouldFullWalk, type Seen,
} from "./collector/hotset.ts";

const NOW = 1_000_000_000_000;

test("selectHotSet: só mtime dentro das últimas 24 h", () => {
  const files = new Map<string, Seen>([
    ["quente", { mtimeMs: NOW - 1000, size: 1 }],
    ["limite", { mtimeMs: NOW - HOT_WINDOW_MS, size: 1 }],
    ["frio", { mtimeMs: NOW - HOT_WINDOW_MS - 1, size: 1 }],
  ]);
  assert.deepEqual(selectHotSet(files, NOW).sort(), ["limite", "quente"]);
});

test("shouldFullWalk: subida e intervalo vencido pelo relógio", () => {
  assert.equal(shouldFullWalk(NOW, null), true);
  assert.equal(shouldFullWalk(NOW + FULL_WALK_INTERVAL_MS - 1, NOW), false);
  assert.equal(shouldFullWalk(NOW + FULL_WALK_INTERVAL_MS, NOW), true);
});

test("pickChanged: walk na subida, depois só o conjunto quente", async () => {
  const idx = newFileIndex();
  const disk = new Map<string, Seen>([
    ["a", { mtimeMs: NOW - 10, size: 5 }],
    ["old", { mtimeMs: NOW - HOT_WINDOW_MS * 3, size: 5 }],
  ]);
  let walks = 0;
  const walkFn = async () => (walks++, [...disk.keys()]);
  const statFn = async (p: string) => disk.get(p) ?? null;

  const first = await pickChanged(idx, NOW, walkFn, statFn);
  assert.equal(walks, 1);
  assert.deepEqual(first.map((c) => c.path).sort(), ["a", "old"]);
  first.forEach((c) => commit(idx, c));

  const stats: string[] = [];
  const spy = async (p: string) => (stats.push(p), disk.get(p) ?? null);
  disk.set("a", { mtimeMs: NOW + 1000, size: 9 });
  const second = await pickChanged(idx, NOW + 1000, walkFn, spy);
  assert.equal(walks, 1, "sem novo walk antes do intervalo");
  assert.deepEqual(stats, ["a"], "arquivo frio não leva stat");
  assert.deepEqual(second.map((c) => c.path), ["a"]);

  const third = await pickChanged(idx, NOW + FULL_WALK_INTERVAL_MS, walkFn, spy);
  assert.equal(walks, 2, "walk completo vencido");
  assert.ok(third.some((c) => c.path === "a"));
});

test("pickChanged: arquivo sumido (ENOENT) sai da lista sem derrubar o ciclo", async () => {
  const idx = newFileIndex();
  const disk = new Map<string, Seen>([["a", { mtimeMs: NOW, size: 1 }], ["b", { mtimeMs: NOW, size: 1 }]]);
  const walkFn = async () => [...disk.keys()];
  const statFn = async (p: string) => disk.get(p) ?? null;
  (await pickChanged(idx, NOW, walkFn, statFn)).forEach((c) => commit(idx, c));
  disk.delete("a");
  const out = await pickChanged(idx, NOW + 1000, walkFn, statFn);
  assert.deepEqual(out, []);
  assert.deepEqual([...idx.files.keys()], ["b"]);
});

test("pickChanged: walk completo também remove o que não existe mais", async () => {
  const idx = newFileIndex();
  idx.files.set("fantasma", { mtimeMs: 1, size: 1 });
  await pickChanged(idx, NOW, async () => [], async () => null);
  assert.equal(idx.files.size, 0);
});

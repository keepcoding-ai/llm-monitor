import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailReader } from "./store.ts";

const row = (agoMs: number, n: number) => JSON.stringify({ at: new Date(Date.now() - agoMs).toISOString(), n });

test("tail reader: lê só o novo, descarta fora da janela e espera a linha completa", () => {
  const dir = mkdtempSync(join(tmpdir(), "lm-tail-"));
  const f = join(dir, "h.jsonl");
  try {
    const read = createTailReader<{ at: string; n: number }>(f, 60_000);
    assert.deepEqual(read(), []); // arquivo ausente
    writeFileSync(f, row(3_600_000, 1) + "\n" + row(1_000, 2) + "\n");
    assert.deepEqual(read().map((r) => r.n), [2]); // a linha de 1 h está fora da janela de 1 min
    appendFileSync(f, row(500, 3).slice(0, 20)); // linha rasgada no meio de um append
    assert.deepEqual(read().map((r) => r.n), [2]);
    appendFileSync(f, row(500, 3).slice(20) + "\n" + row(100, 4) + "\n");
    assert.deepEqual(read().map((r) => r.n), [2, 3, 4]);
    writeFileSync(f, row(10, 9) + "\n"); // arquivo trocado/encolhido: recomeça
    assert.deepEqual(read().map((r) => r.n), [9]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

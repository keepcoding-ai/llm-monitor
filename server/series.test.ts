import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "lm-series-"));
process.env.LLM_MONITOR_STATE = dir; // antes de importar o store (os caminhos nascem no import)
const { addRecords, loadSeries, records, seen, stats, trimSeries, RETENTION_MS, hashId } = await import("./series.ts");
type Rec = Parameters<typeof addRecords>[0][number];

const rec = (id: string, ts: number): Rec => ({ id, ts, source: "claude-code", account: "a", model: "m", project: "p", session: "s", side: false, platform: false, input: 1, output: 1, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, thinking: 0, webSearch: 0, cost: 0.1, priceTable: "t" });

test("série: dedupe por id, janela quente em memória e tudo no disco", async () => {
  const now = Date.now();
  const old = now - RETENTION_MS - 86_400_000;
  assert.equal(addRecords([rec("a", now), rec("a", now), rec("b", now - 1000), rec("velho", old)]), 3);
  assert.equal(addRecords([rec("a", now)]), 0); // já visto
  assert.equal(records.length, 2); // o antigo não fica em memória
  assert.equal(stats.total, 3);
  assert.equal(readFileSync(join(dir, "collector", "series.jsonl"), "utf8").trim().split("\n").length, 3);
  assert.ok(records.every((r) => r.id === ""));

  // reinício: relê em fluxo, mantém a janela quente, total completo e dedupe
  records.length = 0;
  seen.clear();
  stats.total = 0;
  await loadSeries();
  assert.deepEqual(records.map((r) => r.ts), [now - 1000, now]);
  assert.equal(stats.total, 3);
  assert.equal(addRecords([rec("b", now - 1000)]), 0);

  // trim: o que envelhece sai da memória
  assert.equal(trimSeries(now + RETENTION_MS + 5000), 2);
  assert.equal(records.length, 0);
});

test("série: registro com mais de 8 dias fica enxuto (só o que os agregados de 28/30 dias leem)", () => {
  const now = Date.now();
  records.length = 0;
  addRecords([rec("n1", now), rec("v1", now - 10 * 86_400_000), rec("v2", now - 9 * 86_400_000)]);
  trimSeries(now);
  const [a, b, c] = records;
  assert.deepEqual(Object.keys(a).sort(), ["cacheRead", "cacheWrite", "cost", "id", "input", "model", "output", "platform", "source", "ts"]);
  assert.equal(a.ts, now - 10 * 86_400_000);
  assert.equal(b.session, undefined);
  assert.equal(c.session, "s"); // o recente segue completo
});

test("hashId: estável e sem colisão em ids parecidos", () => {
  const hs = new Set(Array.from({ length: 50_000 }, (_, i) => hashId(`msg_01ABC${i.toString(36)}`)));
  assert.equal(hs.size, 50_000);
  assert.equal(hashId("x"), hashId("x"));
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

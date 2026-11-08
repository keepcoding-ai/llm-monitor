import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore plain ESM helper
import { createAnalyzer } from "../scripts/bench/engine.mjs";
// @ts-ignore plain ESM helper
import { buildReport } from "../scripts/bench/report.mjs";

const prices = { version: "t", source: "", models: [{ match: "claude-test", input: 1, output: 5, cacheWrite5m: 2, cacheWrite1h: 4, cacheRead: 0.1 }] };
const T0 = Date.parse("2026-01-01T00:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

function asst(id: string, min: number, u: { cw?: number; cr?: number; out?: number }, content: any[] = [], extra: any = {}) {
  return { type: "assistant", sessionId: "S1", timestamp: at(min), cwd: "/x/proj", ...extra, message: { id, model: "claude-test", content, usage: { input_tokens: 10, output_tokens: u.out ?? 100, cache_creation_input_tokens: u.cw ?? 0, cache_read_input_tokens: u.cr ?? 0 } } };
}
const result = (toolId: string, chars: number, extra: any = {}) => ({ type: "user", sessionId: "S1", ...extra, message: { content: [{ type: "tool_result", tool_use_id: toolId, content: "x".repeat(chars) }] } });

test("carry, idle rebuild, compaction, dedupe and sidechain linking", () => {
  const an = createAnalyzer({ prices, sinceMs: 0 });
  const read = { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/x/secret/file.ts" } };
  const agent = { type: "tool_use", id: "a1", name: "Agent", input: { subagent_type: "Explore", prompt: "SECRET PROMPT" } };
  an.ingest(asst("m0", 0, { cw: 20000 }, [read]));
  an.ingest(asst("m0", 0, { cw: 20000 }, [agent])); // same message.id on another line: usage once, extra tool_use kept
  an.ingest(result("r1", 40000));
  an.ingest(result("a1", 2000, { toolUseResult: { agentId: "ag1" } }));
  an.ingest(asst("m1", 1, { cw: 10000, cr: 20000 }));
  an.ingest(asst("m2", 2, { cw: 100, cr: 30000 }));
  an.ingest(asst("m3", 3, { cw: 100, cr: 30100 }));
  an.ingest(asst("m4", 10, { cw: 30000 })); // 7 min gap > TTL, rebuild
  an.ingest(asst("m5", 11, { cw: 100, cr: 30000 }));
  an.ingest(asst("m6", 12, { cw: 5000 })); // ctx collapses: compaction boundary
  // sidechain
  const side = { agentId: "ag1", side: true };
  an.ingest(asst("s0", 0.5, { cw: 1000, out: 200 }, [], { isSidechain: true, agentId: "ag1" }), side);
  an.ingest(asst("s1", 0.6, { cr: 1000, out: 300 }, [], { isSidechain: true, agentId: "ag1" }), side);

  const res = an.finalize();
  // dedupe: 7 main turns + 2 side
  assert.equal(res.totals.turns, 9);
  const s = res.sessions.get("S1");
  assert.equal(s.mainTurns, 7);
  assert.equal(s.sideTurns, 2);
  assert.equal(s.compactions, 1);

  // exact cost of turn m0: 10*1 + 100*5 + 20000*2 = 40510 / 1e6
  // carry of r1: 10000 tok x (cacheWrite 2 once + cacheRead 0.1 x turns m2..m5) = 10000*(2+0.4)/1e6
  const r1 = res.allCalls.find((c: any) => c.id === "r1");
  assert.equal(r1.tokens, 10000);
  assert.equal(r1.carried, 5);
  assert.ok(Math.abs(r1.carry - 0.024) < 1e-9, String(r1.carry));
  assert.equal(r1.hint, "file.ts"); // basename only, directories never leak
  assert.ok(!JSON.stringify(res.allCalls).includes("SECRET"));

  // idle rebuild: 30000 * (2 - 0.1) / 1e6 excess
  assert.equal(res.idleRebuilds.length, 1);
  assert.ok(Math.abs(res.idleRebuilds[0].excess - 0.057) < 1e-9);
  assert.ok(Math.abs(res.idleRebuilds[0].gross - 0.06) < 1e-9);

  // sidechain linked to the Agent call
  const sub = res.subagents[0];
  assert.equal(sub.agentId, "ag1");
  assert.equal(sub.resultTokens, 500);
  assert.equal(sub.sidechainTurns, 2);
  const expectedSide = (10 + 200 * 5 + 1000 * 2) / 1e6 + (10 + 300 * 5 + 1000 * 0.1) / 1e6;
  assert.ok(Math.abs(sub.sidechainCost - expectedSide) < 1e-9);

  const rep = buildReport(res, { top: 3, since: "7d" });
  assert.ok(Math.abs(rep.totals.costShare.input + rep.totals.costShare.output + rep.totals.costShare.cacheWrite + rep.totals.costShare.cacheRead - 1) < 1e-9);
  assert.ok(!JSON.stringify(rep).includes("secret"));
});

test("since filter drops older turns", () => {
  const an = createAnalyzer({ prices, sinceMs: T0 + 5 * 60_000 });
  an.ingest(asst("a", 0, { cw: 1000 }));
  an.ingest(asst("b", 6, { cw: 1000 }));
  assert.equal(an.finalize().totals.turns, 1);
});

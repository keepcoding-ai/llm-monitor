import { test } from "node:test";
import assert from "node:assert/strict";
import { initialParserState, reduceChatEvent, summarizeInput, type ChatEmit } from "./chat-steps.ts";
import { parseConfig } from "./store.ts";
import { buildChatArgs } from "./llm.ts";

const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const textStart = { type: "stream_event", event: { type: "content_block_start", content_block: { type: "text" } } };

// dois turnos: texto → tool_use → tool_result → texto
const FIXTURE = [
  { type: "system", subtype: "init" },
  textStart,
  delta("Vou olhar o arquivo."),
  { type: "assistant", message: { content: [{ type: "text", text: "Vou olhar o arquivo." }, { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "D:/x/a.ts" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "conteúdo do arquivo" }] }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "tu_2", name: "Bash", input: { command: "x".repeat(400) } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_2", is_error: true, content: "y".repeat(800) }] } },
  textStart,
  delta("Pronto, "),
  delta("deu certo."),
  { type: "result", result: "Pronto, deu certo." },
];

function run(events: any[]) {
  let state = initialParserState();
  const emits: ChatEmit[] = [];
  for (const ev of events) {
    const r = reduceChatEvent(state, ev, "msg", () => "T");
    state = r.state;
    emits.push(...r.emits);
  }
  return { state, emits };
}

test("passos: tool_use vira step running e tool_result vira step-done", () => {
  const { state, emits } = run(FIXTURE);
  const steps = emits.filter((e) => e.type === "step") as Extract<ChatEmit, { type: "step" }>[];
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0], { type: "step", id: "msg", step: { id: "tu_1", name: "Read", input: "D:/x/a.ts", status: "running", at: "T" } });
  assert.ok(steps[1].step.input.length <= 300);
  const done = emits.filter((e) => e.type === "step-done") as Extract<ChatEmit, { type: "step-done" }>[];
  assert.deepEqual(done[0], { type: "step-done", id: "msg", stepId: "tu_1", ok: true, output: "conteúdo do arquivo" });
  assert.equal(done[1].ok, false);
  assert.ok(done[1].output.length <= 500);
  assert.deepEqual(state.steps.map((s) => s.status), ["done", "error"]);
});

test("texto: acumulado de todos os turnos, separado por parágrafo", () => {
  const { state } = run(FIXTURE);
  assert.equal(state.text, "Vou olhar o arquivo.\n\nPronto, deu certo.");
});

test("mensagem assistant repetida não duplica passo; tool_result órfão é ignorado", () => {
  const { state } = run([FIXTURE[3], FIXTURE[3], { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "nope", content: "z" }] } }]);
  assert.equal(state.steps.length, 1);
  assert.equal(state.steps[0].status, "running");
});

test("não muta o estado recebido", () => {
  const s0 = initialParserState();
  reduceChatEvent(s0, delta("a"), "m");
  assert.equal(s0.text, "");
});

test("summarizeInput cai no JSON quando não há campo conhecido", () => {
  assert.equal(summarizeInput({ foo: 1 }), '{"foo":1}');
});

test("config antiga com chatModel migra para chat.model", () => {
  const c = parseConfig({ collectIntervalSec: 15, chatModel: "sonnet", platformDailyBudgetUSD: 2 });
  assert.equal(c.chat.model, "sonnet");
  assert.equal(c.chatModel, "sonnet");
  assert.equal(c.chat.bypassPermissions, true);
  assert.deepEqual(c.chat.dirs, ["D:/atrium"]);
  assert.equal(c.chat.timeoutMin, 60);
  assert.equal(c.chat.ignoreBudget, true);
  assert.equal(c.chat.effort, undefined);
});

test("config nova: chat.model vence o chatModel legado", () => {
  const c = parseConfig({ chatModel: "haiku", chat: { model: "opus", effort: "high", dirs: ["E:/x"] } });
  assert.equal(c.chat.model, "opus");
  assert.equal(c.chat.effort, "high");
  assert.deepEqual(c.chat.dirs, ["E:/x"]);
});

test("args do chat: sem --tools, com bypass, effort e add-dir", () => {
  const cfg = parseConfig({ chat: { model: "sonnet", effort: "high", dirs: ["E:/x"] } }).chat;
  const args = buildChatArgs(cfg, "SYS", "sess-1");
  assert.ok(!args.includes("--tools"));
  assert.ok(args.includes("--dangerously-skip-permissions"));
  assert.deepEqual(args.slice(0, 4), ["--model", "sonnet", "--effort", "high"]);
  assert.equal(args.filter((a) => a === "--add-dir").length, 3);
  assert.ok(args.includes("E:/x"));
  assert.deepEqual(args.slice(-2), ["--resume", "sess-1"]);
  assert.ok(!buildChatArgs({ ...cfg, bypassPermissions: false, effort: undefined }, "S").some((a) => a === "--dangerously-skip-permissions" || a === "--effort"));
});

test("PUT /config: chat parcial preserva os outros campos de chat", async () => {
  const { mergeConfig } = await import("./config-merge.ts");
  const cur = parseConfig({ chat: { model: "opus", effort: "high", dirs: ["E:/x"], timeoutMin: 30 } });
  const next = mergeConfig(cur, { chat: { effort: "low" } } as any);
  assert.equal(next.chat.effort, "low");
  assert.equal(next.chat.model, "opus");
  assert.deepEqual(next.chat.dirs, ["E:/x"]);
  assert.equal(next.chat.timeoutMin, 30);
  assert.equal(next.chatModel, "opus");
  assert.equal(next.pulse.everyMinutes, cur.pulse.everyMinutes);
});

test("PUT /config: trocar chat.model atualiza o espelho chatModel; chatModel legado vira chat.model", async () => {
  const { mergeConfig } = await import("./config-merge.ts");
  const cur = parseConfig({ chat: { model: "haiku", effort: "high" } });
  assert.equal(mergeConfig(cur, { chat: { model: "fable" } } as any).chatModel, "fable");
  const legacy = mergeConfig(cur, { chatModel: "sonnet" } as any);
  assert.equal(legacy.chat.model, "sonnet");
  assert.equal(legacy.chat.effort, "high");
  // corpo completo reenviado sem mudança não desfaz o chat
  assert.equal(mergeConfig(cur, { ...cur, pulse: { enabled: false } } as any).chat.effort, "high");
});

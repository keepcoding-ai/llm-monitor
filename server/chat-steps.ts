// Parser puro do stream-json do chat: devolve, para cada evento do `claude`, o que publicar no
// canal SSE do chat e o novo estado (texto acumulado de todos os turnos + passos de ferramenta).
import type { ChatStep } from "../shared/chat.ts";

export type ParserState = { text: string; steps: ChatStep[] };
export type ChatEmit =
  | { type: "delta"; id: string; text: string }
  | { type: "step"; id: string; step: ChatStep }
  | { type: "step-done"; id: string; stepId: string; ok: boolean; output: string };

export const initialParserState = (): ParserState => ({ text: "", steps: [] });

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Resumo curto (≤300) do input de uma ferramenta: o campo que diz o que ela faz, senão o JSON. */
export function summarizeInput(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    for (const k of ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
      if (typeof o[k] === "string" && o[k]) return clip(o[k] as string, 300);
    }
  }
  return clip(typeof input === "string" ? input : JSON.stringify(input ?? {}), 300);
}

function summarizeOutput(content: unknown): string {
  if (typeof content === "string") return clip(content, 500);
  if (Array.isArray(content)) return clip(content.map((b) => (b && typeof b === "object" && typeof (b as any).text === "string" ? (b as any).text : b?.type === "image" ? "[imagem]" : "")).filter(Boolean).join("\n"), 500);
  return "";
}

/** Reduz um evento do stream. Não muta o estado recebido; `now` injetável para teste. */
export function reduceChatEvent(state: ParserState, ev: any, id: string, now: () => string = () => new Date().toISOString()): { state: ParserState; emits: ChatEmit[] } {
  const emits: ChatEmit[] = [];
  let { text, steps } = state;
  if (ev?.type === "stream_event" && !ev.parent_tool_use_id) {
    const e = ev.event;
    // Novo bloco de texto depois de turnos anteriores: separa por parágrafo para o acumulado ler bem.
    if (e?.type === "content_block_start" && e.content_block?.type === "text" && text && !text.endsWith("\n\n")) {
      const sep = text.endsWith("\n") ? "\n" : "\n\n";
      text += sep;
      emits.push({ type: "delta", id, text: sep });
    }
    if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && typeof e.delta.text === "string") {
      text += e.delta.text;
      emits.push({ type: "delta", id, text: e.delta.text });
    }
  } else if (ev?.type === "assistant" && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b?.type !== "tool_use" || !b.id || steps.some((s) => s.id === b.id)) continue;
      const step: ChatStep = { id: String(b.id), name: String(b.name ?? "?"), input: summarizeInput(b.input), status: "running", at: now() };
      steps = [...steps, step];
      emits.push({ type: "step", id, step });
    }
  } else if (ev?.type === "user" && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b?.type !== "tool_result" || !b.tool_use_id) continue;
      const stepId = String(b.tool_use_id);
      if (!steps.some((s) => s.id === stepId)) continue;
      const ok = !b.is_error;
      const output = summarizeOutput(b.content);
      steps = steps.map((s) => (s.id === stepId ? { ...s, status: ok ? "done" : "error", output } : s));
      emits.push({ type: "step-done", id, stepId, ok, output });
    }
  }
  return { state: { text, steps }, emits };
}

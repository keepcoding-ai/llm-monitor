// Chat global (plano §6, G10): vive no shell, fora da plataforma viva — é o único
// componente com estado de conversa, então nunca é trocado ao vivo. O estado
// (mensagens, streaming, rascunho) mora num store de módulo: fechar e reabrir o
// painel/drawer não perde histórico nem rascunho.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Markdown, Textarea, Spinner, ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Tooltip, TooltipContent, TooltipTrigger } from "@atrium/core-ui";
import { ArrowUp, ArrowCounterClockwise, Stop } from "@phosphor-icons/react";
import { call, onChat, usd, useLive, type ChatMsg } from "./sdk";

type ChatState = { msgs: ChatMsg[]; loaded: boolean; streaming: { id: string; text: string } | null; err: string | null; draft: string; lastQuestion: string; shown: number; model: string | null };
let st: ChatState = { msgs: [], loaded: false, streaming: null, err: null, draft: "", lastQuestion: "", shown: 50, model: null };
const subs = new Set<() => void>();
const set = (p: Partial<ChatState>) => {
  st = { ...st, ...p };
  subs.forEach((f) => f());
};
const useChat = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);

let started = false;
function start() {
  if (started) return;
  started = true;
  call<ChatMsg[]>("/chat").then((msgs) => set({ msgs, loaded: true }), (e) => set({ err: (e as Error).message, loaded: true }));
  call<{ config: { chatModel: string } }>("/config").then((r) => set({ model: r.config.chatModel }), () => undefined);
  onChat((ev) => {
    if (ev.type === "message") {
      if (!st.msgs.some((x) => x.id === ev.message.id)) set({ msgs: [...st.msgs, ev.message] });
      if (ev.message.role === "assistant") {
        set({ streaming: null });
        // erro: a pergunta volta ao campo para tentar de novo
        if (ev.message.error && !st.draft) set({ draft: st.lastQuestion });
      }
    } else if (ev.type === "start") set({ streaming: { id: ev.id, text: "" } });
    else if (ev.type === "delta") set({ streaming: st.streaming && st.streaming.id === ev.id ? { ...st.streaming, text: st.streaming.text + ev.text } : { id: ev.id, text: ev.text } });
    else if (ev.type === "error") set({ err: ev.error, streaming: null, draft: st.draft || st.lastQuestion });
  });
}

async function send(text: string, context: string) {
  const q = text.trim();
  if (!q) return;
  set({ err: null, draft: "", lastQuestion: q, streaming: { id: "pending", text: "" } });
  try {
    await call("/chat", { body: { message: q, context } });
  } catch (e) {
    set({ err: (e as Error).message, streaming: null, draft: q });
  }
}

/** Preço na frente (G7): mediana do custo real das últimas respostas. */
function typicalCost(msgs: ChatMsg[]): number | null {
  const c = msgs.filter((m) => m.role === "assistant" && typeof m.costUSD === "number").slice(-20).map((m) => m.costUSD!).sort((a, b) => a - b);
  return c.length ? c[Math.floor(c.length / 2)] : null;
}

export function ChatPanel({ chips, context, autoFocus }: { chips: string[]; context: string; autoFocus?: boolean }) {
  useEffect(start, []);
  const s = useChat();
  const connected = useLive((x) => x.connected);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.msgs.length, s.streaming?.text]);
  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const visible = s.msgs.slice(-s.shown);
  const hidden = s.msgs.length - visible.length;
  const cost = typicalCost(s.msgs);
  const busy = Boolean(s.streaming);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div ref={box} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1" aria-live="polite">
        {hidden > 0 && (
          <Button variant="ghost" size="sm" className="self-center" onClick={() => set({ shown: s.shown + 50 })}>
            Ver anteriores ({hidden})
          </Button>
        )}
        {s.loaded && s.msgs.length === 0 && !busy && <p className="text-sm text-muted-foreground">Pergunte o que a tela não respondeu. Escolha uma pergunta pronta ou escreva a sua.</p>}
        {visible.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl bg-secondary px-3 py-2 text-sm">{m.text}</div>
          ) : (
            <div key={m.id} className="text-sm">
              {m.error ? (
                <ErrorNotice variant="action">
                  <ErrorNoticeMessage>{m.error}</ErrorNoticeMessage>
                  {m.id === [...s.msgs].reverse().find((x) => x.role === "assistant")?.id && (
                    <ErrorNoticeAction onClick={() => void send(s.lastQuestion || s.draft, context)}>Tentar de novo</ErrorNoticeAction>
                  )}
                </ErrorNotice>
              ) : (
                <Markdown source={m.text} measure="reading" />
              )}
              {m.costUSD != null && <div className="mt-1 text-xs text-muted-foreground">custou {usd(m.costUSD, 4)}</div>}
            </div>
          ),
        )}
        {s.streaming && (
          <div className="text-sm">
            {s.streaming.text ? <Markdown source={s.streaming.text} measure="reading" /> : <span className="inline-flex items-center gap-2 text-muted-foreground"><Spinner /> pensando…</span>}
          </div>
        )}
      </div>

      {s.err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{s.err}</ErrorNoticeMessage>
          <ErrorNoticeAction onClick={() => void send(s.draft || s.lastQuestion, context)}>Tentar de novo</ErrorNoticeAction>
        </ErrorNotice>
      )}

      <AnimatePresence initial={false}>
        {!busy && chips.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap gap-1.5" aria-label="Perguntas prontas">
            {chips.map((c) => (
              <Button
                key={c}
                variant="outline"
                size="sm"
                className="h-auto min-h-9 max-w-full whitespace-normal! rounded-full py-1.5 text-left text-xs"
                onClick={() => {
                  set({ draft: c });
                  field.current?.focus();
                }}
              >
                {c}
              </Button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <Textarea
          ref={field}
          value={s.draft}
          rows={2}
          disabled={!connected}
          className="min-w-0 flex-1 text-base md:text-sm"
          placeholder={connected ? "Pergunte sobre custo, limites ou o painel" : "Sem conexão com o monitor — o chat volta quando reconectar"}
          onChange={(e) => set({ draft: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void send(s.draft, context);
            }
          }}
        />
        <div className="flex flex-col gap-1">
          {busy ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline" className="size-11 md:size-9" aria-label="Parar a resposta" onClick={() => call("/chat/stop", { body: {} })}>
                  <Stop weight="fill" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Parar</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" className="size-11 md:size-9" aria-label="Enviar" disabled={!s.draft.trim() || !connected} onClick={() => void send(s.draft, context)}>
                  <ArrowUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Enviar</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="size-11 md:size-9" aria-label="Nova conversa" disabled={busy} onClick={() => call("/chat/reset", { body: {} })}>
                <ArrowCounterClockwise />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Nova conversa (o modelo esquece o contexto)</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="chat-price">
        responde com {s.model ?? "…"} · {cost != null ? `~${usd(cost, 2)} por pergunta` : "custo aparece após a primeira resposta"}
      </p>
    </div>
  );
}

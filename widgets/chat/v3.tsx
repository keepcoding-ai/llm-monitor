// Chat de gestão de custo e evolução do app (claude -p, haiku por padrão),
// com resposta em streaming pelo canal SSE.
import { useEffect, useRef, useState } from "react";
import { Button, Markdown, Textarea, ErrorNotice, ErrorNoticeMessage, Spinner, Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@atrium/core-ui";
import { ArrowUp, ArrowCounterClockwise } from "@phosphor-icons/react";
import { call, onChat, usd, type ChatMsg } from "../../src/sdk";

export default function Chat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    call<ChatMsg[]>("/chat").then(setMsgs, (e) => setErr((e as Error).message));
    const off = onChat((ev) => {
      if (ev.type === "message") {
        setMsgs((m) => (m.some((x) => x.id === ev.message.id) ? m : [...m, ev.message]));
        if (ev.message.role === "assistant") setStreaming(null);
      } else if (ev.type === "start") setStreaming({ id: ev.id, text: "" });
      else if (ev.type === "delta") setStreaming((s) => (s && s.id === ev.id ? { ...s, text: s.text + ev.text } : { id: ev.id, text: ev.text }));
      else if (ev.type === "error") {
        setErr(ev.error);
        setStreaming(null);
      }
    });
    return () => {
      off();
    };
  }, []);
  // Rola só a caixa da conversa (nunca a página) e com corpo em chaves: o
  // scrollIntoView do Chrome novo devolve Promise, que o React tomava por cleanup.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, streaming?.text]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setErr(null);
    setDraft("");
    setStreaming({ id: "pending", text: "" });
    try {
      await call("/chat", { body: { message: text } });
    } catch (e) {
      setErr((e as Error).message);
      setStreaming(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="flex max-h-[60dvh] min-h-40 flex-col gap-3 overflow-y-auto overscroll-contain pr-1 md:max-h-[28rem] tv:max-h-[36rem]">
        {msgs.length === 0 && !streaming && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Pergunte sobre o seu gasto</EmptyTitle>
              <EmptyDescription>Por exemplo: “por que gastei tanto ontem?” ou “que modelo devo usar nos subagentes?”</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl bg-secondary px-3 py-2 text-sm">{m.text}</div>
          ) : (
            <div key={m.id} className="text-sm">
              {m.error ? (
                <ErrorNotice variant="action">
                  <ErrorNoticeMessage>{m.error}</ErrorNoticeMessage>
                </ErrorNotice>
              ) : (
                <Markdown source={m.text} measure="reading" />
              )}
              {m.costUSD != null && <div className="mt-1 text-xs text-muted-foreground">custou {usd(m.costUSD, 4)}</div>}
            </div>
          ),
        )}
        {streaming && (
          <div className="text-sm">
            {streaming.text ? <Markdown source={streaming.text} measure="reading" /> : <span className="inline-flex items-center gap-2 text-muted-foreground"><Spinner /> pensando…</span>}
          </div>
        )}
      </div>
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          rows={2}
          className="min-w-0 flex-1 text-base md:text-sm"
          placeholder="Pergunte sobre custo, limites ou peça uma melhoria no painel"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <Button size="icon" className="size-11 md:size-9" aria-label="Enviar" disabled={!draft.trim() || Boolean(streaming)} onClick={send}>
            <ArrowUp />
          </Button>
          <Button size="icon" variant="ghost" className="size-11 md:size-9" aria-label="Nova conversa" onClick={() => call("/chat/reset", { body: {} })}>
            <ArrowCounterClockwise />
          </Button>
        </div>
      </div>
    </div>
  );
}

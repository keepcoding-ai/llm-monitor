// Chat global (plano §6, G10): vive no shell, fora da plataforma viva — é o único
// componente com estado de conversa, então nunca é trocado ao vivo. O estado
// (mensagens, streaming, rascunho) mora num store de módulo: fechar e reabrir o
// painel/drawer não perde histórico nem rascunho.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, InputGroup, InputGroupAddon, InputGroupTextarea, Markdown, Spinner, ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Tooltip, TooltipContent, TooltipTrigger } from "@atrium/core-ui";
import { ArrowUp, NotePencil, Stop, Paperclip, X, FilePdf } from "@phosphor-icons/react";
import { API, call, onChat, usd, useLive, type ChatMsg } from "./sdk";

type Pending = { id: string; name: string; type: string; data: string; url: string };
type ChatState = { msgs: ChatMsg[]; loaded: boolean; streaming: { id: string; text: string } | null; err: string | null; draft: string; lastQuestion: string; shown: number; model: string | null; pending: Pending[]; lastAttachments: Pending[] };
let st: ChatState = { msgs: [], loaded: false, streaming: null, err: null, draft: "", lastQuestion: "", shown: 50, model: null, pending: [], lastAttachments: [] };

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;

/** Lê imagens/PDF (anexo, colagem ou arraste) para o rascunho; o que não serve vira aviso. */
async function addFiles(files: File[]) {
  const ok: Pending[] = [];
  let warn: string | null = null;
  for (const f of files) {
    if (!ACCEPT.split(",").includes(f.type)) { warn = `"${f.name}" não é imagem nem PDF — só esses entram.`; continue; }
    if (f.size > MAX_BYTES) { warn = `"${f.name}" passa de 8 MB.`; continue; }
    if (st.pending.length + ok.length >= MAX_FILES) { warn = `No máximo ${MAX_FILES} anexos por mensagem.`; break; }
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    }).catch(() => "");
    if (!url) continue;
    ok.push({ id: crypto.randomUUID(), name: f.name || `colado.${f.type.split("/")[1]}`, type: f.type, data: url.slice(url.indexOf(",") + 1), url });
  }
  set({ pending: [...st.pending, ...ok], err: warn });
}
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
        if (ev.message.error && !st.draft) set({ draft: st.lastQuestion, pending: st.pending.length ? st.pending : st.lastAttachments });
      }
    } else if (ev.type === "start") set({ streaming: { id: ev.id, text: "" } });
    else if (ev.type === "delta") set({ streaming: st.streaming && st.streaming.id === ev.id ? { ...st.streaming, text: st.streaming.text + ev.text } : { id: ev.id, text: ev.text } });
    else if (ev.type === "error") set({ err: ev.error, streaming: null, draft: st.draft || st.lastQuestion, pending: st.pending.length ? st.pending : st.lastAttachments });
  });
}

async function send(text: string, context: string) {
  const q = text.trim();
  if (!q && !st.pending.length) return;
  const sent = st.pending;
  set({ err: null, draft: "", lastQuestion: q, pending: [], lastAttachments: sent, streaming: { id: "pending", text: "" } });
  try {
    await call("/chat", { body: { message: q, context, attachments: sent.map(({ name, type, data }) => ({ name, type, data })) } });
  } catch (e) {
    set({ err: (e as Error).message, streaming: null, draft: q, pending: sent });
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
  const picker = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  // Layout de uma linha (clipe | texto | enviar) vs. multilinha (texto em cima, botões embaixo).
  // "multi" é pegajoso até o campo esvaziar: no modo largo o texto caberia de novo em uma linha e o layout oscilaria.
  const [multi, setMulti] = useState(false);
  const [width, setWidth] = useState(0);
  // o painel entra animado (largura crescendo): remede quando a largura do campo muda
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [multi]);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, lh * 8 + pad)}px`;
    el.style.overflowY = el.scrollHeight > lh * 8 + pad ? "auto" : "hidden";
    if (!s.draft) setMulti(false);
    else if (!multi && (s.draft.includes("\n") || el.scrollHeight > lh + pad + 4)) setMulti(true);
  }, [s.draft, multi, width, connected]);
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

  const attachBtn = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className="size-11 rounded-full md:size-9" aria-label="Anexar imagem ou PDF" disabled={!connected || busy} onClick={() => picker.current?.click()}>
          <Paperclip />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Anexar imagem ou PDF (ou cole / arraste)</TooltipContent>
    </Tooltip>
  );
  const sendBtn = busy ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="outline" className="size-11 rounded-full md:size-9" aria-label="Parar a resposta" onClick={() => call("/chat/stop", { body: {} })}>
          <Stop weight="fill" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Parar</TooltipContent>
    </Tooltip>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" className="size-11 rounded-full md:size-9" aria-label="Enviar" disabled={(!s.draft.trim() && !s.pending.length) || !connected} onClick={() => void send(s.draft, context)}>
          <ArrowUp />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Enviar</TooltipContent>
    </Tooltip>
  );

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
            <div key={m.id} className="flex max-w-[85%] flex-col gap-2 self-end whitespace-pre-wrap break-words rounded-2xl bg-secondary px-3 py-2 text-sm">
              {m.attachments?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {m.attachments.map((a) =>
                    a.type.startsWith("image/") ? (
                      <a key={a.file} href={`${API}/chat/files/${a.file}`} target="_blank" rel="noreferrer">
                        <img src={`${API}/chat/files/${a.file}`} alt={a.name} className="max-h-40 max-w-full rounded-lg border" />
                      </a>
                    ) : (
                      <a key={a.file} href={`${API}/chat/files/${a.file}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><FilePdf /> {a.name}</a>
                    ),
                  )}
                </div>
              ) : null}
              {m.text}
            </div>
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

      {s.pending.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Anexos da mensagem">
          {s.pending.map((p) => (
            <div key={p.id} className="relative">
              {p.type.startsWith("image/") ? (
                <img src={p.url} alt={p.name} className="size-16 rounded-lg border object-cover" />
              ) : (
                <div className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border bg-muted px-1 text-[10px] text-muted-foreground"><FilePdf className="size-5" /><span className="w-full truncate text-center">{p.name}</span></div>
              )}
              <button type="button" aria-label={`Remover ${p.name}`} className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-popover text-popover-foreground" onClick={() => set({ pending: st.pending.filter((x) => x.id !== p.id) })}>
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <InputGroup
        data-testid="chat-composer"
        data-multiline={multi}
        className={`rounded-3xl bg-background dark:bg-background ${drag ? "ring-2 ring-ring" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { setDrag(false); if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles([...e.dataTransfer.files]); } }}
      >
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {!multi && <InputGroupAddon key="clip" align="inline-start" className="pl-1.5">{attachBtn}</InputGroupAddon>}
        <InputGroupTextarea
          key="field"
          ref={field}
          value={s.draft}
          rows={1}
          disabled={!connected}
          className={`field-sizing-fixed min-h-0 min-w-0 px-3 py-2.5 text-base md:text-sm ${multi ? "flex-none" : ""}`}
          placeholder={connected ? "Pergunte ao monitor" : "Sem conexão com o monitor — o chat volta quando reconectar"}
          onChange={(e) => set({ draft: e.target.value })}
          onPaste={(e) => {
            const imgs = [...e.clipboardData.items].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
            if (imgs.length) { e.preventDefault(); void addFiles(imgs); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void send(s.draft, context);
            }
          }}
        />
        {multi ? (
          <InputGroupAddon key="bar" align="block-end" className="justify-between px-1.5 pb-1.5">{attachBtn}{sendBtn}</InputGroupAddon>
        ) : (
          <InputGroupAddon key="send" align="inline-end" className="pr-1.5">{sendBtn}</InputGroupAddon>
        )}
      </InputGroup>
      <p className="text-xs text-muted-foreground" data-testid="chat-price">
        responde com {s.model ?? "…"} · {cost != null ? `~${usd(cost, 2)} por pergunta` : "custo aparece após a primeira resposta"}
      </p>
    </div>
  );
}

/** Botão "Novo chat" do cabeçalho do painel: zera a conversa (o modelo esquece o contexto). */
export function NewChatButton() {
  const s = useChat();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9" aria-label="Novo chat" disabled={Boolean(s.streaming)} onClick={() => call("/chat/reset", { body: {} })}>
          <NotePencil />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Novo chat</TooltipContent>
    </Tooltip>
  );
}

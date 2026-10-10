// Chat global (plano §6, G10): vive no shell, fora da plataforma viva — é o único
// componente com estado de conversa, então nunca é trocado ao vivo. O estado
// (mensagens, streaming, rascunho) mora num store de módulo: fechar e reabrir o
// painel/drawer não perde histórico nem rascunho.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button, InputGroup, InputGroupAddon, InputGroupTextarea, Markdown, Spinner, ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Tooltip, TooltipContent, TooltipTrigger, Collapsible, CollapsibleContent, CollapsibleTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@atrium/core-ui";
import { ArrowClockwise, ArrowUp, Check, CaretRight, Cube, FilePdf, FileText, MagnifyingGlass, NotePencil, Paperclip, PencilSimple, Robot, Stop, Terminal, Wrench, X } from "@phosphor-icons/react";
import { API, addSlot, call, onChat, usd, useLayout, useLive, useRestartPending, type ChatMsg, type ChatStep } from "./sdk";
import { go, setHash, usePage } from "./router";

type Pending = { id: string; name: string; type: string; data: string; url: string };
type Streaming = { id: string; text: string; steps: ChatStep[]; startedAt: number };
type WidgetCard = { id: string; v: number; status: "active" | "testing" | "failed"; title: string };
type ChatState = { cards: WidgetCard[]; msgs: ChatMsg[]; loaded: boolean; streaming: Streaming | null; err: string | null; draft: string; lastQuestion: string; shown: number; model: string | null; effort: string | null; pending: Pending[]; lastAttachments: Pending[] };
let st: ChatState = { cards: [], msgs: [], loaded: false, streaming: null, err: null, draft: "", lastQuestion: "", shown: 50, model: null, effort: null, pending: [], lastAttachments: [] };

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
  call<{ config: { chat: { model: string; effort?: string } } }>("/config").then((r) => set({ model: r.config.chat.model, effort: r.config.chat.effort ?? null }), () => undefined);
  onChat((ev) => {
    if (ev.type === "message") {
      if (!st.msgs.some((x) => x.id === ev.message.id)) set({ msgs: [...st.msgs, ev.message] });
      if (ev.message.role === "assistant") {
        set({ streaming: null });
        // erro: a pergunta volta ao campo para tentar de novo
        if (ev.message.error && !st.draft) set({ draft: st.lastQuestion, pending: st.pending.length ? st.pending : st.lastAttachments });
      }
    } else if (ev.type === "widget") {
      // vários eventos do mesmo widget atualizam o mesmo cartão
      const card: WidgetCard = { id: ev.id, v: ev.v, status: ev.status, title: ev.title };
      set({ cards: st.cards.some((c) => c.id === ev.id) ? st.cards.map((c) => (c.id === ev.id ? card : c)) : [...st.cards, card] });
    } else if (ev.type === "reset") set({ cards: [], msgs: [], streaming: null, err: null, draft: "", pending: [], lastQuestion: "", lastAttachments: [] });
    else if (ev.type === "start") set({ streaming: { id: ev.id, text: "", steps: [], startedAt: st.streaming?.startedAt ?? Date.now() } });
    else if (ev.type === "delta") set({ streaming: st.streaming && st.streaming.id === ev.id ? { ...st.streaming, text: st.streaming.text + ev.text } : { id: ev.id, text: ev.text, steps: [], startedAt: st.streaming?.startedAt ?? Date.now() } });
    else if (ev.type === "step" && st.streaming) set({ streaming: { ...st.streaming, steps: [...st.streaming.steps.filter((x) => x.id !== ev.step.id), ev.step] } });
    else if (ev.type === "step-done" && st.streaming) set({ streaming: { ...st.streaming, steps: st.streaming.steps.map((x) => (x.id === ev.stepId ? { ...x, status: ev.ok ? "done" : "error", output: ev.output } : x)) } });
    else if (ev.type === "error") set({ err: ev.error, streaming: null, draft: st.draft || st.lastQuestion, pending: st.pending.length ? st.pending : st.lastAttachments });
  });
}

async function send(text: string, context: string) {
  const q = text.trim();
  if (!q && !st.pending.length) return;
  const sent = st.pending;
  set({ err: null, draft: "", lastQuestion: q, pending: [], lastAttachments: sent, streaming: { id: "pending", text: "", steps: [], startedAt: Date.now() } });
  try {
    await call("/chat", { body: { message: q, context, attachments: sent.map(({ name, type, data }) => ({ name, type, data })) } });
  } catch (e) {
    set({ err: (e as Error).message, streaming: null, draft: q, pending: sent });
  }
}

/** Grava parte de `chat` na config; o server mescla campo a campo. `null` limpa o esforço. */
async function setChatConfig(patch: { model?: string; effort?: string | null }) {
  const prev = { model: st.model, effort: st.effort };
  set({ ...(patch.model ? { model: patch.model } : {}), ...("effort" in patch ? { effort: patch.effort ?? null } : {}) });
  try {
    await call("/config", { method: "PUT", body: { chat: patch } });
  } catch (e) {
    set({ ...prev, err: (e as Error).message });
  }
}

const MODELS = ["haiku", "sonnet", "opus", "fable"];
const EFFORTS: { value: string; label: string }[] = [
  { value: "default", label: "padrão do modelo" },
  { value: "low", label: "baixo" },
  { value: "medium", label: "médio" },
  { value: "high", label: "alto" },
];

/** Tempo decorrido desde `since`, atualizando a cada segundo. */
function useElapsed(since: number | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since == null) return null;
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return s < 60 ? `há ${s}s` : `há ${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** Ícone por ferramenta do agente. */
function stepIcon(name: string) {
  if (name === "Bash") return Terminal;
  if (name === "Read") return FileText;
  if (name === "Edit" || name === "Write" || name === "NotebookEdit" || name === "MultiEdit") return PencilSimple;
  if (name === "Grep" || name === "Glob") return MagnifyingGlass;
  if (name === "Agent" || name === "Task") return Robot;
  return Wrench;
}

function StepRow({ step }: { step: ChatStep }) {
  const Icon = stepIcon(step.name);
  const err = step.status === "error";
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-2.5 text-left text-xs md:min-h-9">
        <CaretRight className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
        {step.status === "running" ? <Spinner className="size-4 shrink-0" /> : <Icon className={`size-4 shrink-0 ${err ? "text-x-error" : "text-muted-foreground"}`} />}
        <span className={`shrink-0 font-medium ${err ? "text-x-error" : ""}`}>{step.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{step.input}</span>
        {err && <span className="shrink-0 text-x-error">erro</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 border-t px-2.5 py-2 text-xs">
        <div>
          <div className="mb-0.5 text-muted-foreground">entrada</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">{step.input}</pre>
        </div>
        <div>
          <div className="mb-0.5 text-muted-foreground">saída</div>
          {step.output != null ? <pre className={`max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono ${err ? "text-x-error" : ""}`}>{step.output || "(vazia)"}</pre> : <span className="text-muted-foreground">em andamento…</span>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** "N passos" sob a resposta: recolhida no histórico, aberta enquanto a resposta está em curso. */
function StepList({ steps, live }: { steps: ChatStep[]; live?: boolean }) {
  if (!steps.length) return null;
  const errs = steps.filter((x) => x.status === "error").length;
  return (
    <Collapsible defaultOpen={live} className="mt-2">
      <CollapsibleTrigger className="group flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground md:min-h-9">
        <CaretRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
        {steps.length} {steps.length === 1 ? "passo" : "passos"}
        {errs > 0 && <span className="text-x-error">· {errs} com erro</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1.5">
        {steps.map((x) => <StepRow key={x.id} step={x} />)}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Indicador da resposta em curso: atividade atual + cronômetro. */
function LiveStatus({ streaming }: { streaming: Streaming }) {
  const elapsed = useElapsed(streaming.startedAt);
  const running = [...streaming.steps].reverse().find((x) => x.status === "running");
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground" data-testid="chat-live">
      <Spinner /> {running ? running.name : streaming.text ? "respondendo…" : "pensando…"}
      <span className="text-xs tabular-nums">{elapsed}</span>
    </span>
  );
}

/** Cartão "widget pronto": estado vivo do widget que o chat criou ou versionou. */
function WidgetCardView({ card }: { card: WidgetCard }) {
  const layout = useLayout();
  const page = usePage();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // testing → pronto quando o layout publica essa versão (ou uma mais nova) como ativa
  const activeV = layout?.versions[card.id]?.find((x) => x.status === "active")?.v ?? 0;
  const status = card.status === "testing" && activeV >= card.v ? "active" : card.status;
  const current = layout?.pages.find((p) => p.id === page);
  const isGrid = current?.kind === "grid";
  const firstGrid = [...(layout?.pages ?? [])].sort((a, b) => a.order - b.order).find((p) => p.kind === "grid");
  const add = async () => {
    if (!current) return;
    setBusy(true);
    setErr(null);
    try {
      await addSlot(current.id, card.id);
      setAdded(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const failed = status === "failed";
  return (
    <div className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${failed ? "border-x-error/40" : ""}`} data-testid="chat-widget-card" data-status={status}>
      <div className="flex items-start gap-2">
        {status === "testing" ? <Spinner className="mt-0.5 size-4 shrink-0" /> : <Cube className={`mt-0.5 size-4 shrink-0 ${failed ? "text-x-error" : "text-x-success"}`} />}
        <span className={failed ? "text-x-error" : ""}>
          {status === "active" && <>Widget <strong>{card.title}</strong> pronto (versão {card.v})</>}
          {status === "testing" && <>Widget <strong>{card.title}</strong> aguardando teste de tela</>}
          {failed && <>Widget <strong>{card.title}</strong> reprovado no teste</>}
        </span>
      </div>
      {status === "active" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="min-h-11 md:min-h-9" disabled={!isGrid || busy || added} onClick={() => void add()}>
            {added ? <Check /> : null} {added ? "Adicionado" : "Adicionar a esta página"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-9"
            onClick={() => {
              if (!isGrid && firstGrid) go(firstGrid.id);
              setHash("colecao");
            }}
          >
            Ver na coleção
          </Button>
        </div>
      )}
      {err && <p className="text-xs text-x-error">{err}</p>}
    </div>
  );
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
  const restartPending = useRestartPending();

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
              {m.steps?.length ? <StepList steps={m.steps} /> : null}
              {m.costUSD != null && <div className="mt-1 text-xs text-muted-foreground">custou {usd(m.costUSD, 4)}</div>}
            </div>
          ),
        )}
        {s.cards.map((c) => <WidgetCardView key={c.id} card={c} />)}
        {s.streaming && (
          <div className="text-sm">
            {s.streaming.text && <Markdown source={s.streaming.text} measure="reading" />}
            <StepList key={s.streaming.id} steps={s.streaming.steps} live />
            <LiveStatus streaming={s.streaming} />
          </div>
        )}
      </div>

      {restartPending && (
        <p className="rounded-lg border border-x-alert/40 px-3 py-2 text-xs text-x-alert" role="status" data-testid="chat-restart-banner">
          O servidor reinicia ao fim desta resposta.
        </p>
      )}

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
        className={`bg-background p-1.5 dark:bg-background ${multi ? "rounded-[28px] md:rounded-[24px]" : "rounded-full"} ${drag ? "ring-2 ring-ring" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { setDrag(false); if (e.dataTransfer.files.length) { e.preventDefault(); void addFiles([...e.dataTransfer.files]); } }}
      >
        <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {!multi && <InputGroupAddon key="clip" align="inline-start" className="m-0 p-0 has-[>button]:m-0">{attachBtn}</InputGroupAddon>}
        <InputGroupTextarea
          key="field"
          ref={field}
          value={s.draft}
          rows={1}
          disabled={!connected}
          className={`field-sizing-fixed min-h-0 min-w-0 px-3 text-base md:text-sm ${multi ? "flex-none py-2.5" : "py-0"}`}
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
          <InputGroupAddon key="bar" align="block-end" className="m-0 justify-between p-0 group-has-[>input]/input-group:pb-0 has-[>button]:m-0">{attachBtn}{sendBtn}</InputGroupAddon>
        ) : (
          <InputGroupAddon key="send" align="inline-end" className="m-0 p-0 has-[>button]:m-0">{sendBtn}</InputGroupAddon>
        )}
      </InputGroup>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="chat-price">
        <div className="flex items-center gap-2">
          <Select value={s.model ?? undefined} onValueChange={(v) => void setChatConfig({ model: v })}>
            <SelectTrigger size="sm" className="h-11 min-w-0 flex-1 gap-1 text-xs md:h-8" aria-label="Modelo do chat"><span className="text-muted-foreground">Modelo</span><SelectValue placeholder="…" /></SelectTrigger>
            <SelectContent>{MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={s.effort ?? "default"} onValueChange={(v) => void setChatConfig({ effort: v === "default" ? null : v })}>
            <SelectTrigger size="sm" className="h-11 min-w-0 flex-1 gap-1 text-xs md:h-8" aria-label="Esforço do chat"><span className="text-muted-foreground">Esforço</span><SelectValue /></SelectTrigger>
            <SelectContent>{EFFORTS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}</SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground md:size-8" aria-label="Reiniciar servidor" disabled={restartPending || !connected} onClick={() => void call("/system/restart", { body: {} }).catch((e) => set({ err: (e as Error).message }))}>
                <ArrowClockwise />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reiniciar servidor</TooltipContent>
          </Tooltip>
        </div>
        <span>{cost != null ? `~${usd(cost, 2)} por pergunta` : "custo aparece após a primeira resposta"}</span>
      </div>
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

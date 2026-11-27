// Shell do LLM Monitor (plano §2, §7) — sem topbar fixa.
// Celular/tablet: cabeçalho no fluxo + barra inferior fixa (até 5 itens; o resto em "Mais").
// Desktop/TV: trilho esquerdo + painel de chat à direita. Nome "LLM Monitor" leva à home em todo tier.
// Fixo no shell: cabeçalho, navegação, chat, Ajustes. Vivo: páginas, menu e widgets vêm do layout (grid · single · settings).
// Detours livres (#): chat (celular/tablet), versoes/<widget> e colecao (widgets que entram na página).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Badge, Button,
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Skeleton, Spinner, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@atrium/core-ui";
import { Check, ChatCircleText, ClockCounterClockwise, DotsThree, PencilSimple, Plus, Warning, X } from "@phosphor-icons/react";
import { ThemeRoot } from "./theme";
import { ago, call, connect, useLayout, useLink, useLive, useSnapshot } from "./sdk";
import { LinkDot, LinkStatus, ServiceDownNotice, useDownTitle } from "./link";
import { TestHarness } from "./runtime";
import { ChatPanel, NewChatButton } from "./chat";
import { PageGrid, SlotCard, useSlots } from "./grid";
import { CollectionDetour } from "./collection";
import { iconFor } from "./icons";
import { VerdictNotifier } from "./notify";
import { PwaNotices } from "./pwa";
import { BrandSymbol } from "./ui";
import { AjustesPage } from "./pages/ajustes";
import { fixLegacyRoute, go, pageHref, pref, setHash, setPref, useHash, useMedia, usePage, useTier } from "./router";
import type { PageDef, WidgetVersion } from "../shared/snapshot";

fixLegacyRoute();

// ------------------------------------------------------------ versões (detour livre)

const statusLabel: Record<WidgetVersion["status"], { t: string; tone: "info" | "success" | "warning" | "error" | "muted" }> = {
  active: { t: "no ar", tone: "success" },
  testing: { t: "em teste", tone: "info" },
  checking: { t: "conferindo tipos", tone: "info" },
  failed: { t: "reprovada", tone: "error" },
  retired: { t: "guardada", tone: "muted" },
};

function VersionsBody({ widget }: { widget: string }) {
  const layout = useLayout();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = [...(layout?.versions[widget] ?? [])].sort((a, b) => b.v - a.v);
  const hist = layout?.history[widget] ?? [];
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" disabled={busy || hist.length < 2} onClick={() => act(() => call(`/widgets/${widget}/undo`, { body: {} }))}>
        <ClockCounterClockwise /> Desfazer última troca
      </Button>
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <motion.ul className="flex flex-col gap-2" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.04 } } }}>
        {list.map((v) => (
          <motion.li key={v.v} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">Versão {v.v}</span>
              <Badge tone={statusLabel[v.status].tone}>{statusLabel[v.status].t}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{v.note || "—"} · {ago(v.at)}</p>
            {v.error && <p className="mt-1 text-sm text-x-error">{v.error}</p>}
            {v.status === "retired" && (
              <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => act(() => call(`/widgets/${widget}/restore/${v.v}`, { body: {} }))}>
                Pôr no ar
              </Button>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

function VersionsDetour() {
  const hash = useHash();
  const desktop = useMedia("(min-width: 768px)");
  const layout = useLayout();
  const widget = /^versoes\/([a-z0-9-]+)/.exec(hash)?.[1] ?? null;
  const open = Boolean(widget);
  const close = (o: boolean) => !o && setHash("");
  const title = widget ? `Versões — ${layout?.collection.find((m) => m.id === widget)?.title ?? widget}` : "Versões";
  const desc = "Cada troca passa por conferência de tipos e render de teste antes de entrar no ar.";
  if (desktop)
    return (
      <Sheet open={open} onOpenChange={close}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{desc}</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto">{widget && <VersionsBody widget={widget} />}</div>
        </SheetContent>
      </Sheet>
    );
  return (
    <Drawer open={open} onOpenChange={close}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{desc}</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[70dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">{widget && <VersionsBody widget={widget} />}</div>
      </DrawerContent>
    </Drawer>
  );
}

// ------------------------------------------------------------ cabeçalho e navegação

function HomeMark({ className = "" }: { className?: string }) {
  return (
    <a
      href={pageHref("agora")}
      onClick={(e) => {
        e.preventDefault();
        go("agora");
      }}
      className={`inline-flex min-h-11 items-center gap-2 rounded-md text-lg font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring xl:min-h-0 ${className}`}
      aria-label="LLM Monitor — ir para Agora"
    >
      <BrandSymbol className="size-7 tv:size-9" />
      <h1>LLM Monitor</h1>
    </a>
  );
}

function AlertsButton() {
  const n = useSnapshot()?.flags.filter((f) => !f.ack).length ?? 0;
  const page = usePage();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={page === "avisos" ? "secondary" : "ghost"} size="sm" className="min-h-11 gap-1.5 px-2.5 xl:min-h-9" aria-label={`Avisos: ${n} ${n === 1 ? "aberto" : "abertos"}`} onClick={() => go("avisos")}>
          <Warning className={n ? "text-x-alert" : ""} weight={n ? "fill" : "regular"} />
          <span className="tabular">{n}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Avisos</TooltipContent>
    </Tooltip>
  );
}

function ChatButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={open ? "secondary" : "outline"} size="sm" className="min-h-11 xl:min-h-9" aria-pressed={open} onClick={onToggle}>
          <ChatCircleText /> Chat
        </Button>
      </TooltipTrigger>
      <TooltipContent>{open ? "Fechar o chat" : "Abrir o chat (tecla /)"}</TooltipContent>
    </Tooltip>
  );
}

/** Páginas do menu, vindas do layout: só `menu: true`, por `order`. */
function useMenuPages(): PageDef[] {
  const layout = useLayout();
  return (layout?.pages ?? []).filter((p) => p.menu).sort((a, b) => a.order - b.order);
}

const BAR_MAX = 5;

function BottomBar() {
  const page = usePage();
  const pages = useMenuPages();
  const [more, setMore] = useState(false);
  // até 5 itens: passou disso, os 4 primeiros ficam e o resto vai para "Mais"
  const overflow = pages.length > BAR_MAX;
  const shown = overflow ? pages.slice(0, BAR_MAX - 1) : pages;
  const rest = overflow ? pages.slice(BAR_MAX - 1) : [];
  const restActive = rest.some((p) => p.id === page);
  const itemCls = (active: boolean) =>
    `relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs outline-none focus-visible:bg-muted md:flex-row md:gap-2 md:text-sm ${active ? "font-medium text-primary" : "text-muted-foreground"}`;
  const mark = (active: boolean) => active && <motion.span layoutId="nav-active" className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />;
  return (
    <>
      <nav aria-label="Navegação" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, shown.length + (overflow ? 1 : 0))}, minmax(0, 1fr))` }}>
          {shown.map((p) => {
            const Icon = iconFor(p.icon);
            const active = page === p.id;
            return (
              <li key={p.id}>
                <a
                  href={pageHref(p.id)}
                  onClick={(e) => {
                    e.preventDefault();
                    go(p.id);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={itemCls(active)}
                >
                  {mark(active)}
                  <Icon className="size-5" weight={active ? "fill" : "regular"} />
                  {p.title}
                </a>
              </li>
            );
          })}
          {overflow && (
            <li>
              <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} className={itemCls(restActive)}>
                {mark(restActive)}
                <DotsThree className="size-5" weight="bold" />
                Mais
              </button>
            </li>
          )}
        </ul>
      </nav>
      {overflow && (
        <Drawer open={more} onOpenChange={setMore}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Mais páginas</DrawerTitle>
              <DrawerDescription className="sr-only">Páginas que não cabem na barra inferior.</DrawerDescription>
            </DrawerHeader>
            <ul className="flex flex-col gap-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {rest.map((p) => {
                const Icon = iconFor(p.icon);
                const active = page === p.id;
                return (
                  <li key={p.id}>
                    <a
                      href={pageHref(p.id)}
                      onClick={(e) => {
                        e.preventDefault();
                        setMore(false);
                        go(p.id);
                      }}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-base outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-muted font-medium" : ""}`}
                    >
                      <Icon className="size-5" weight={active ? "fill" : "regular"} /> {p.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

function Rail() {
  const page = usePage();
  const pages = useMenuPages();
  const snap = useSnapshot();
  const v = snap?.verdict;
  const w5 = v?.windows.find((w) => w.id === "5h")?.usedPct;
  const w7 = v?.windows.find((w) => w.id === "7d")?.usedPct;
  return (
    <aside className="sticky top-0 hidden h-dvh w-48 shrink-0 flex-col gap-4 border-r px-3 py-4 xl:flex tv:w-56">
      <HomeMark className="tv:text-xl" />
      <nav className="flex flex-col gap-0.5" aria-label="Navegação">
        {pages.map((p) => {
          const Icon = iconFor(p.icon);
          const active = page === p.id;
          return (
            <a
              key={p.id}
              href={pageHref(p.id)}
              onClick={(e) => {
                e.preventDefault();
                go(p.id);
              }}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring tv:text-base ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {active && <motion.span layoutId="rail-active" className="absolute inset-0 -z-10 rounded-md bg-muted" />}
              <Icon className="size-4 tv:size-5" weight={active ? "fill" : "regular"} /> {p.title}
            </a>
          );
        })}
      </nav>
      {snap?.account && (
        <div className="mt-auto text-sm">
          <div className="truncate font-medium">{snap.account.name || snap.account.email}</div>
          <div className="truncate text-xs text-muted-foreground">{snap.account.email}</div>
          {w5 != null && w7 != null && <div className="tabular mt-1 text-xs text-muted-foreground">5 h {Math.round(w5)} % · semana {Math.round(w7)} %</div>}
        </div>
      )}
    </aside>
  );
}

// ------------------------------------------------------------ chat (painel/drawer global)

function chatContext(page: string, s: ReturnType<typeof useSnapshot>) {
  const v = s?.verdict;
  return `tela: ${page}${v ? ` · veredito: ${v.headline}` : ""}`;
}

function ChatHeaderActions({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <NewChatButton />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9" aria-label="Fechar o chat" onClick={onClose}>
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Fechar</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Painel direito do desktop/TV: largura arrastável dentro da faixa do tier e lembrada. */
function ChatSidePanel({ tier, onClose }: { tier: "desktop" | "tv"; onClose: () => void }) {
  const page = usePage();
  const s = useSnapshot();
  const [min, max] = tier === "tv" ? [440, 560] : [380, 420];
  const [w, setW] = useState(() => Math.min(max, Math.max(min, pref(`chat-width-${tier}`, tier === "tv" ? 480 : 400))));
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => setW((x) => Math.min(max, Math.max(min, x))), [min, max]);
  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      style={{ width: w }}
      className="sticky top-3 my-3 mr-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 flex-col rounded-2xl border bg-card shadow-lg xl:flex"
      aria-label="Chat"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar o chat"
        tabIndex={0}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-ring/30"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setW(Math.min(max, Math.max(min, drag.current.w + (drag.current.x - e.clientX))));
        }}
        onPointerUp={() => {
          drag.current = null;
          setPref(`chat-width-${tier}`, w);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            const n = Math.min(max, Math.max(min, w + (e.key === "ArrowLeft" ? 10 : -10)));
            setW(n);
            setPref(`chat-width-${tier}`, n);
          }
        }}
      />
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold">Chat</span>
        <ChatHeaderActions onClose={onClose} />
      </div>
      <div className="min-h-0 flex-1 p-4">
        <ChatPanel context={chatContext(page, s)} autoFocus />
      </div>
    </motion.aside>
  );
}

function ChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const page = usePage();
  const s = useSnapshot();
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="h-[85dvh] max-h-[85dvh]">
        <DrawerHeader className="flex-row items-center justify-between py-2 text-left">
          <div>
            <DrawerTitle>Chat</DrawerTitle>
            <DrawerDescription className="sr-only">Pergunte sobre custo, limites ou o painel.</DrawerDescription>
          </div>
          <ChatHeaderActions onClose={onClose} />
        </DrawerHeader>
        <div className="min-h-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <ChatPanel context={chatContext(page, s)} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Estado do chat: celular/tablet = #chat (detour livre); desktop/TV = painel lembrado (TV nasce fechado). */
function useChatOpen(tier: ReturnType<typeof useTier>) {
  const hash = useHash();
  const wide = tier === "desktop" || tier === "tv";
  const [side, setSide] = useState(() => pref(`chat-open-${tier}`, false));
  useEffect(() => setSide(pref(`chat-open-${tier}`, false)), [tier]);
  useEffect(() => {
    // #chat vindo de um link abre o painel no desktop e sai do endereço
    if (wide && hash === "chat") {
      setSide(true);
      setPref(`chat-open-${tier}`, true);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, [wide, hash, tier]);
  const open = wide ? side : hash === "chat";
  const set = (o: boolean) => {
    if (wide) {
      setSide(o);
      setPref(`chat-open-${tier}`, o);
    } else setHash(o ? "chat" : "");
  };
  return [open, set] as const;
}

// ------------------------------------------------------------ páginas

/** `pinned` (edit mode): the row sticks to the top of <main>, full-bleed and opaque, so the edit actions stay reachable while the grid scrolls. */
function PageTitle({ children, actions, pinned }: { children: ReactNode; actions?: ReactNode; pinned?: boolean }) {
  const pin = "sticky top-0 z-30 -mx-4 flex-nowrap border-b bg-background px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:-mx-4 md:px-4 xl:-mx-5 xl:px-5 tv:-mx-8 tv:px-8";
  return (
    <div className={`mb-3 flex items-center gap-x-3 gap-y-2 ${pinned ? pin : "flex-wrap"}`}>
      <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight tv:text-2xl">{children}</h2>
      {actions}
    </div>
  );
}

/** Só nas páginas `grid`: alterna o modo de edição; em edição oferece a coleção. */
function EditActions({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant={editing ? "default" : "outline"} size="sm" className="min-h-11 xl:min-h-9" aria-pressed={editing} onClick={onToggle}>
        {editing ? <Check /> : <PencilSimple />} {editing ? "Concluir" : "Editar página"}
      </Button>
      {editing && (
        <Button variant="outline" size="sm" className="min-h-11 xl:min-h-9" onClick={() => setHash("colecao")}>
          <Plus /> Adicionar widget
        </Button>
      )}
    </div>
  );
}

/** `single`: fluxo em coluna (Reserva, Avisos) — cards na largura toda, altura do conteúdo. */
function SinglePage({ page }: { page: string }) {
  const layout = useLayout();
  const slots = useSlots(page);
  if (!layout) return <Skeleton className="h-40" />;
  return (
    <div className="flex flex-col gap-4">
      {slots.map((s) => (
        <SlotCard key={s.id} spec={s} />
      ))}
    </div>
  );
}

/** Despacho por `kind` do layout. */
function PageView({ def }: { def: PageDef }) {
  // o modo de edição vale só para esta página: a troca de página remonta o componente e ele volta a falso
  const [editing, setEditing] = useState(false);
  return (
    <>
      <PageTitle pinned={editing} actions={def.kind === "grid" ? <EditActions editing={editing} onToggle={() => setEditing(!editing)} /> : undefined}>{def.title}</PageTitle>
      {def.kind === "grid" && <PageGrid page={def.id} editing={editing} />}
      {def.kind === "single" && <SinglePage page={def.id} />}
      {def.kind === "settings" && <AjustesPage />}
    </>
  );
}

// ------------------------------------------------------------ app

export function App() {
  useEffect(connect, []);
  const snap = useSnapshot();
  const progress = useLive((s) => s.progress);
  const collectorError = useLive((s) => s.collectorError);
  const link = useLink();
  // fora do ar: escurece a última leitura (e os esqueletos, que não estão carregando nada)
  const stale = link === "down";
  useDownTitle();
  const pageId = usePage();
  const layout = useLayout();
  // id desconhecido (ou layout ainda chegando) cai em Agora
  const def = layout?.pages.find((p) => p.id === pageId) ?? layout?.pages.find((p) => p.id === "agora") ?? layout?.pages[0];
  const page = def?.id ?? pageId;
  const tier = useTier();
  const wide = tier === "desktop" || tier === "tv";
  const [chatOpen, setChatOpen] = useChatOpen(tier);

  // "/" abre o chat no desktop (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && wide && !/INPUT|TEXTAREA/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  // rola para o topo ao trocar de página
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [page]);

  return (
    <TooltipProvider>
      <ThemeRoot />
      <div className="flex min-h-dvh">
        <Rail />
        <main className="@container min-w-0 flex-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-4 xl:px-5 xl:pb-4 tv:px-8">
          <header className="mb-3 flex items-center justify-between gap-2 xl:mb-3 xl:pt-2">
            <div className="flex min-w-0 items-center gap-3">
              <HomeMark className="xl:hidden" />
              <span className="hidden md:inline-flex xl:inline-flex">
                <LinkStatus />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="md:hidden">
                <LinkDot />
              </span>
              <AlertsButton />
              <ChatButton open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} />
            </div>
          </header>

          <ServiceDownNotice />
          <PwaNotices />
          {collectorError && (
            <ErrorNotice variant="load" className="mb-4">
              <ErrorNoticeMessage>O coletor falhou no último ciclo: {collectorError}</ErrorNoticeMessage>
            </ErrorNotice>
          )}
          {!snap && link === "live" && (
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Primeira leitura do histórico{progress ? ` — ${progress.files} arquivos, ${progress.records.toLocaleString("pt-BR")} respostas` : "…"}
            </div>
          )}

          {/* framer anima opacity inline no filho; a degradação mora num invólucro próprio */}
          <div data-stale={stale || undefined} className="stale-fade">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              {def ? <PageView def={def} /> : <Skeleton className="h-40" />}
            </motion.div>
          </AnimatePresence>
          </div>
        </main>
        <AnimatePresence>{wide && chatOpen && <ChatSidePanel key="chat" tier={tier as "desktop" | "tv"} onClose={() => setChatOpen(false)} />}</AnimatePresence>
      </div>
      <BottomBar />
      {!wide && <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />}
      <VersionsDetour />
      <CollectionDetour def={def} />
      <VerdictNotifier />
      <TestHarness />
    </TooltipProvider>
  );
}

// Shell do LLM Monitor (plano §2, §7) — sem topbar fixa.
// Celular/tablet: cabeçalho no fluxo + barra inferior fixa (Agora · Semana · Reserva · Ajustes).
// Desktop/TV: trilho esquerdo + painel de chat à direita. Nome "LLM Monitor" leva à home em todo tier.
// Fixo no shell: cabeçalho, navegação, veredito, Cabe?, chat, Ajustes. Vivo: widgets por página.
// Detours livres (#): chat (celular/tablet) e versoes/<widget>.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle,
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Skeleton, Spinner, StatusDot, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@atrium/core-ui";
import { CalendarBlank, ChatCircleText, ClockCounterClockwise, GearSix, House, Lifebuoy, Warning, X } from "@phosphor-icons/react";
import { ThemeRoot } from "./theme";
import { ago, call, connect, useLayout, useLive, useSnapshot } from "./sdk";
import { SlotBoundary, TestHarness, useWidget } from "./runtime";
import { VerdictBlock, useTick } from "./verdict";
import { ChatPanel, NewChatButton } from "./chat";
import { CabeBlock } from "./cabe";
import { VerdictNotifier } from "./notify";
import { AjustesPage } from "./pages/ajustes";
import { PAGES, fixLegacyRoute, go, pageHref, pref, setHash, setPref, useHash, useMedia, usePage, useTier, type Page } from "./router";
import type { PageId, SlotSpec, WidgetVersion } from "../shared/snapshot";

fixLegacyRoute();

// ------------------------------------------------------------ slot (peça viva)

/** Card de widget sem cromo. Na troca: anel + selo "versão n" por 2,6 s; tocar no selo abre as versões. */
export function Slot({ spec }: { spec: SlotSpec }) {
  const { Comp, error } = useWidget(spec.widget, spec.version);
  const reduce = useReducedMotion();
  const [fresh, setFresh] = useState(false);
  const [lastV, setLastV] = useState(spec.version);
  useEffect(() => {
    if (spec.version !== lastV) {
      setLastV(spec.version);
      setFresh(true);
    }
  }, [spec.version, lastV]);
  // o selo dura 2,6 s (efeito separado: a troca de lastV não pode cancelar o timer)
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(false), 2600);
    return () => clearTimeout(t);
  }, [fresh, lastV]);
  const openVersions = () => setHash(`versoes/${spec.widget}`);
  return (
    <motion.section layout={!reduce} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-slot-id={spec.id} className="min-w-0">
      <Card className={`h-full gap-3 py-4 transition-shadow duration-500 ${fresh ? "ring-2 ring-x-highlight" : ""}`}>
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {spec.title}
            <AnimatePresence>
              {fresh && (
                <motion.button
                  type="button"
                  onClick={openVersions}
                  aria-label={`Versão ${spec.version} entrou no ar — abrir versões`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Badge tone="info">versão {spec.version}</Badge>
                </motion.button>
              )}
            </AnimatePresence>
          </CardTitle>
        </CardHeader>
        <CardContent className="relative px-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={spec.version}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98, filter: "blur(6px)", transition: { duration: 0.2, ease: "easeIn" } }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              {error ? (
                <ErrorNotice variant="load">
                  <ErrorNoticeMessage>Esta peça quebrou: {error}</ErrorNoticeMessage>
                  <ErrorNoticeAction onClick={openVersions}>Versões</ErrorNoticeAction>
                </ErrorNotice>
              ) : !Comp ? (
                <div className="space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <SlotBoundary
                  key={spec.version}
                  fallback={(err, reset) => (
                    <ErrorNotice variant="load">
                      <ErrorNoticeMessage>Esta peça quebrou: {err.message}</ErrorNoticeMessage>
                      <ErrorNoticeAction onClick={reset}>Tentar de novo</ErrorNoticeAction>
                      <ErrorNoticeAction onClick={openVersions}>Versões</ErrorNoticeAction>
                    </ErrorNotice>
                  )}
                >
                  <Comp />
                </SlotBoundary>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.section>
  );
}

export function useSlots(page: PageId) {
  const layout = useLayout();
  return (layout?.slots ?? []).filter((s) => s.page === page).sort((a, b) => a.order - b.order);
}

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
  const title = widget ? `Versões — ${layout?.slots.find((s) => s.widget === widget)?.title ?? widget}` : "Versões";
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

function LiveStatus() {
  const connected = useLive((s) => s.connected);
  const snap = useSnapshot();
  useTick();
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <StatusDot status={connected ? "running" : "attention"} label={connected ? "Ao vivo" : "Sem conexão"} />
      <span className="truncate">{connected ? (snap ? `ao vivo · ${ago(snap.at)}` : "conectando…") : "sem conexão"}</span>
    </span>
  );
}

function HomeMark({ className = "" }: { className?: string }) {
  return (
    <a
      href={pageHref("agora")}
      onClick={(e) => {
        e.preventDefault();
        go("agora");
      }}
      className={`inline-flex min-h-11 items-center rounded-md text-lg font-semibold tracking-tight outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring xl:min-h-0 ${className}`}
      aria-label="LLM Monitor — ir para Agora"
    >
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

const NAV_ICON: Record<Page, typeof House> = { agora: House, semana: CalendarBlank, reserva: Lifebuoy, ajustes: GearSix, avisos: Warning };
const NAV = PAGES.filter((p) => p.id !== "avisos");

function BottomBar() {
  const page = usePage();
  return (
    <nav aria-label="Navegação" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur xl:hidden">
      <ul className="grid grid-cols-4">
        {NAV.map((p) => {
          const Icon = NAV_ICON[p.id];
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
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs outline-none focus-visible:bg-muted md:flex-row md:gap-2 md:text-sm ${active ? "font-medium text-primary" : "text-muted-foreground"}`}
              >
                {active && <motion.span layoutId="nav-active" className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />}
                <Icon className="size-5" weight={active ? "fill" : "regular"} />
                {p.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Rail() {
  const page = usePage();
  const snap = useSnapshot();
  const v = snap?.verdict;
  const w5 = v?.windows.find((w) => w.id === "5h")?.usedPct;
  const w7 = v?.windows.find((w) => w.id === "7d")?.usedPct;
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 border-r px-4 py-6 xl:flex tv:w-64">
      <HomeMark className="tv:text-xl" />
      <nav className="flex flex-col gap-0.5" aria-label="Navegação">
        {NAV.map((p) => {
          const Icon = NAV_ICON[p.id];
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
              className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring tv:text-base ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {active && <motion.span layoutId="rail-active" className="absolute inset-0 -z-10 rounded-md bg-muted" />}
              <Icon className="size-4 tv:size-5" weight={active ? "fill" : "regular"} /> {p.label}
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

const CHIPS: Record<Page, (verdict: ReturnType<typeof useSnapshot>) => string[]> = {
  agora: (s) => {
    const v = s?.verdict;
    const d = v?.windows.find((w) => w.id === v.decisive);
    const reset = d?.resetHuman?.split(",")[0];
    return [
      d ? `Por que ${d.id === "5h" ? "a sessão de 5 h" : d.id === "7d" ? "a semana" : "o Fable"} está subindo nesse ritmo hoje?` : "O que mais gastou hoje?",
      `O que mudar para chegar à renovação${reset ? ` de ${reset}` : ""} com folga?`,
      "Quanto custa uma sessão pesada agora?",
    ];
  },
  semana: () => ["O que mais comeu a semana?", "Onde encaixo uma sessão pesada sem estourar?", "Como esta semana se compara à passada?"],
  reserva: () => ["Qual conta Soul devo usar agora?", "Alguma conta está perto de ficar sem cota?"],
  ajustes: () => ["Qual modelo padrão me faz chegar à renovação?", "Quanto a plataforma gastou hoje e com quê?"],
  avisos: () => ["O que significa o aviso mais recente?", "Algum aviso pede ação minha agora?"],
};

function chatContext(page: Page, s: ReturnType<typeof useSnapshot>) {
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
        <ChatPanel chips={CHIPS[page](s)} context={chatContext(page, s)} autoFocus />
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
          <ChatPanel chips={CHIPS[page](s)} context={chatContext(page, s)} />
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

function PageTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xl font-semibold tracking-tight tv:text-2xl">{children}</h2>;
}

// spans por tier — classes estáticas para o Tailwind enxergar
const MD: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2" };
const XL: Record<number, string> = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3" };
const TVS: Record<number, string> = { 1: "tv:col-span-1", 2: "tv:col-span-2", 3: "tv:col-span-3", 4: "tv:col-span-4" };

function SlotGrid({ page, className, spanned }: { page: PageId; className: string; spanned?: boolean }) {
  const slots = useSlots(page);
  const layout = useLayout();
  if (!layout)
    return (
      <div className={className}>
        <Skeleton className="h-40" />
      </div>
    );
  return (
    <div className={className}>
      {slots.map((s) =>
        spanned ? (
          <div key={s.id} className={`min-w-0 ${MD[Math.min(s.span.md, 2)]} ${XL[Math.min(s.span.xl, 3)]} ${TVS[Math.min(s.span.tv, 4)]}`}>
            <Slot spec={s} />
          </div>
        ) : (
          <Slot key={s.id} spec={s} />
        ),
      )}
    </div>
  );
}

function AgoraPage({ extra }: { extra?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 tv:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] tv:gap-6">
      <Card className="gap-3 px-4 py-5 md:col-span-2 md:px-6 tv:col-span-1 tv:px-8 tv:py-8">
        <VerdictBlock onSettings={() => go("ajustes")} layout="wide" />
      </Card>
      <div className="grid grid-cols-1 items-start gap-4 md:col-span-2 md:grid-cols-2 tv:col-span-1 tv:grid-cols-1 tv:content-start">
        <CabeBlock />
        {extra}
        <SlotGrid page="agora" className="flex flex-col gap-4" />
      </div>
    </div>
  );
}

function SimplePage({ page, title, single }: { page: PageId; title: string; single?: boolean }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      <SlotGrid page={page} spanned={!single} className={single ? "flex flex-col gap-4" : "grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3 tv:grid-cols-4 tv:gap-6"} />
    </>
  );
}

// ------------------------------------------------------------ app

export function App() {
  useEffect(connect, []);
  const snap = useSnapshot();
  const progress = useLive((s) => s.progress);
  const collectorError = useLive((s) => s.collectorError);
  const connected = useLive((s) => s.connected);
  const page = usePage();
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
        <main className="@container min-w-0 flex-1 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 xl:px-8 xl:pb-8 tv:px-12">
          <header className="mb-4 flex items-center justify-between gap-2 xl:mb-6 xl:pt-3">
            <div className="flex min-w-0 items-center gap-3">
              <HomeMark className="xl:hidden" />
              <span className="hidden md:inline-flex xl:inline-flex">
                <LiveStatus />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="md:hidden">
                <StatusDot status={connected ? "running" : "attention"} label={connected ? "Ao vivo" : "Sem conexão"} />
              </span>
              <AlertsButton />
              <ChatButton open={chatOpen} onToggle={() => setChatOpen(!chatOpen)} />
            </div>
          </header>

          {collectorError && (
            <ErrorNotice variant="load" className="mb-4">
              <ErrorNoticeMessage>O coletor falhou no último ciclo: {collectorError}</ErrorNoticeMessage>
            </ErrorNotice>
          )}
          {!snap && (
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Primeira leitura do histórico{progress ? ` — ${progress.files} arquivos, ${progress.records.toLocaleString("pt-BR")} respostas` : "…"}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2, ease: "easeOut" }}>
              {page === "agora" && <AgoraPage />}
              {page === "semana" && <SimplePage page="semana" title="Semana" />}
              {page === "reserva" && <SimplePage page="reserva" title="Reserva" single />}
              {page === "avisos" && <SimplePage page="avisos" title="Avisos" single />}
              {page === "ajustes" && (
                <>
                  <PageTitle>Ajustes</PageTitle>
                  <AjustesPage />
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
        <AnimatePresence>{wide && chatOpen && <ChatSidePanel key="chat" tier={tier as "desktop" | "tv"} onClose={() => setChatOpen(false)} />}</AnimatePresence>
      </div>
      <BottomBar />
      {!wide && <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />}
      <VersionsDetour />
      <VerdictNotifier />
      <TestHarness />
    </TooltipProvider>
  );
}

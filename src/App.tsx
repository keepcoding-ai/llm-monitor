// Shell do LLM Monitor — sem topbar. Mobile: uma coluna, cabeçalho no fluxo.
// Tablet: grade de 2. Desktop: trilho lateral + grade de 3. TV: trilho + grade de 4.
// Rotas: /llm-monitor/ (painel) e /llm-monitor/w/<slot> (widget em foco).
// Detour livre: #versoes/<widget> (painel de versões, dono é o shell).
import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, CardAction,
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
  ErrorNotice, ErrorNoticeMessage, ErrorNoticeAction, Skeleton, Spinner, StatusDot, Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "@atrium/core-ui";
import { ArrowLeft, ArrowsOut, ClockCounterClockwise, Heartbeat, StackSimple } from "@phosphor-icons/react";
import { BASE, ago, call, connect, useLayout, useLive, useSnapshot } from "./sdk";
import { SlotBoundary, TestHarness, useWidget } from "./runtime";
import type { SlotSpec, WidgetVersion } from "../shared/snapshot";

// ------------------------------------------------------------ rota e detour

function usePath() {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener("popstate", f);
      window.addEventListener("hashchange", f);
      return () => {
        window.removeEventListener("popstate", f);
        window.removeEventListener("hashchange", f);
      };
    },
    () => location.pathname + location.hash,
  );
}
export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
function setHash(h: string) {
  if (h) location.hash = h;
  else history.pushState(null, "", location.pathname + location.search);
  dispatchEvent(new HashChangeEvent("hashchange"));
}
function useMedia(q: string) {
  return useSyncExternalStore(
    (f) => {
      const m = matchMedia(q);
      m.addEventListener("change", f);
      return () => m.removeEventListener("change", f);
    },
    () => matchMedia(q).matches,
  );
}

// spans por tier — classes estáticas para o Tailwind enxergar
const MD: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2" };
const XL: Record<number, string> = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3" };
const TV: Record<number, string> = { 1: "tv:col-span-1", 2: "tv:col-span-2", 3: "tv:col-span-3", 4: "tv:col-span-4" };

// ------------------------------------------------------------ slot

function Slot({ spec, focused }: { spec: SlotSpec; focused?: boolean }) {
  const { Comp, error } = useWidget(spec.widget, spec.version);
  const reduce = useReducedMotion();
  const [fresh, setFresh] = useState(false);
  const [lastV, setLastV] = useState(spec.version);
  useEffect(() => {
    if (spec.version !== lastV) {
      setLastV(spec.version);
      setFresh(true);
      const t = setTimeout(() => setFresh(false), 2600);
      return () => clearTimeout(t);
    }
  }, [spec.version, lastV]);

  return (
    <motion.section
      layout={!reduce}
      layoutId={`slot-${spec.id}`}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={focused ? "col-span-full" : `col-span-1 ${MD[Math.min(spec.span.md, 2)]} ${XL[Math.min(spec.span.xl, 3)]} ${TV[Math.min(spec.span.tv, 4)]}`}
      data-slot-id={spec.id}
    >
      <Card className={`h-full gap-3 py-4 transition-shadow duration-500 ${fresh ? "ring-2 ring-x-highlight" : ""}`}>
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            {spec.title}
            <AnimatePresence>
              {fresh && (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 17 }}>
                  <Badge tone="info">versão {spec.version}</Badge>
                </motion.span>
              )}
            </AnimatePresence>
          </CardTitle>
          <CardAction className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={`Versões de ${spec.title}`} onClick={() => setHash(`versoes/${spec.widget}`)}>
                  <StackSimple />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Versões</TooltipContent>
            </Tooltip>
            {!focused && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label={`Abrir ${spec.title} em foco`} onClick={() => navigate(`${BASE}/w/${spec.id}`)}>
                    <ArrowsOut />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Em foco</TooltipContent>
              </Tooltip>
            )}
          </CardAction>
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
                  <ErrorNoticeMessage>Esta versão do widget não carregou: {error}</ErrorNoticeMessage>
                  <ErrorNoticeAction onClick={() => setHash(`versoes/${spec.widget}`)}>Ver versões</ErrorNoticeAction>
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
                      <ErrorNoticeMessage>O widget quebrou: {err.message}</ErrorNoticeMessage>
                      <ErrorNoticeAction onClick={reset}>Tentar de novo</ErrorNoticeAction>
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

// ------------------------------------------------------------ painel de versões (detour)

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
  const path = usePath();
  const desktop = useMedia("(min-width: 768px)");
  const m = /#versoes\/([a-z0-9-]+)/.exec(path);
  const widget = m?.[1] ?? null;
  const open = Boolean(widget);
  const close = (o: boolean) => !o && setHash("");
  const title = "Versões do widget";
  const desc = "Cada troca passa por conferência de tipos e render de teste antes de entrar no ar.";
  if (desktop)
    return (
      <Sheet open={open} onOpenChange={close}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{desc}</SheetDescription>
          </SheetHeader>
          {widget && <VersionsBody widget={widget} />}
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
        <div className="max-h-[70dvh] overflow-y-auto">{widget && <VersionsBody widget={widget} />}</div>
      </DrawerContent>
    </Drawer>
  );
}

// ------------------------------------------------------------ status e pulso

function PulseButton({ full }: { full?: boolean }) {
  const running = useLive((s) => s.pulseRunning || Boolean(s.snapshot?.pulse.running));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size={full ? "default" : "sm"}
        disabled={running}
        onClick={async () => {
          setErr(null);
          try {
            await call("/pulse", { body: {} });
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        {running ? <Spinner /> : <Heartbeat />} {running ? "Pulsando…" : "Pulsar agora"}
      </Button>
      {err && <span className="text-xs text-x-error">{err}</span>}
    </div>
  );
}

function LiveStatus() {
  const connected = useLive((s) => s.connected);
  const snap = useSnapshot();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <StatusDot status={connected ? "running" : "attention"} label={connected ? "Ao vivo" : "Sem conexão"} />
      <span>{connected ? (snap ? `ao vivo · ${ago(snap.at)}` : "conectado") : "sem conexão com o monitor"}</span>
    </div>
  );
}

function Rail({ slots }: { slots: SlotSpec[] }) {
  const snap = useSnapshot();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r px-4 py-6 xl:flex tv:w-72">
      <div>
        <h1 className="text-lg font-semibold tracking-tight tv:text-xl">LLM Monitor</h1>
        <LiveStatus />
      </div>
      {snap?.account && (
        <div className="text-sm">
          <div className="text-muted-foreground">Conta do Claude Code</div>
          <div className="truncate font-medium">{snap.account.name || snap.account.email}</div>
          <div className="truncate text-muted-foreground">{snap.account.email}</div>
        </div>
      )}
      <nav className="flex flex-col gap-0.5">
        {slots.map((s) => (
          <button key={s.id} className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => navigate(`${BASE}/w/${s.id}`)}>
            {s.title}
          </button>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-2">
        <PulseButton full />
        {snap && <span className="text-xs text-muted-foreground">{snap.pulse.lastAt ? `Último pulso ${ago(snap.pulse.lastAt)}` : "Nenhum pulso ainda"}</span>}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------ app

export function App() {
  useEffect(connect, []);
  const layout = useLayout();
  const snap = useSnapshot();
  const progress = useLive((s) => s.progress);
  const collectorError = useLive((s) => s.collectorError);
  const path = usePath();
  const focus = /\/w\/([a-z0-9-]+)/.exec(path)?.[1] ?? null;
  const slots = layout?.slots ?? [];
  const focusSlot = focus ? slots.find((s) => s.id === focus) : null;

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh">
        <Rail slots={slots} />
        <main className="min-w-0 flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] md:px-6 xl:px-8 xl:py-8 tv:px-12">
          {/* cabeçalho no fluxo (mobile/tablet) — some quando o trilho aparece */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 xl:hidden">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">LLM Monitor</h1>
              <LiveStatus />
            </div>
            <PulseButton />
          </div>

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

          <LayoutGroup>
            <AnimatePresence mode="wait">
              {focusSlot ? (
                <motion.div key="focus" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3, ease: "easeInOut" }}>
                  <Button variant="ghost" className="mb-3" onClick={() => navigate(`${BASE}/`)}>
                    <ArrowLeft /> Painel
                  </Button>
                  <div className="grid grid-cols-1">
                    <Slot spec={focusSlot} focused />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="grid"
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 tv:grid-cols-4 tv:gap-6"
                >
                  {slots.map((s) => (
                    <Slot key={s.id} spec={s} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </LayoutGroup>
        </main>
      </div>
      <VersionsDetour />
      <TestHarness />
    </TooltipProvider>
  );
}

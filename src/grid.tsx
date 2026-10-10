// Grade das páginas `grid`: células quadradas de tamanho igual, só em CSS.
// 1 coluna; 2 a partir de @3xl; 3 a partir de @7xl — container query (não media query), então o
// painel de chat aberto, que estreita o <main>, reduz as colunas sozinho.
// `grid-auto-rows` = largura de uma coluna ⇒ célula 1×1 é quadrada; w/h multiplicam (com os gaps).
import { useEffect, useState, type ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Badge, Card, CardContent, CardHeader, CardTitle, ErrorNotice, ErrorNoticeAction, ErrorNoticeMessage, Skeleton } from "@atrium/core-ui";
import { BUILTINS } from "./builtins";
import { SlotBoundary, useWidget } from "./runtime";
import { useLayout } from "./sdk";
import { setHash } from "./router";
import type { SlotSpec } from "../shared/snapshot";

/** Slots de uma página na ordem do layout. */
export function useSlots(page: string) {
  const layout = useLayout();
  return (layout?.slots ?? []).filter((s) => s.page === page).sort((a, b) => a.order - b.order);
}

// spans com classes estáticas, para o Tailwind enxergar. Em 1 coluna todo widget ocupa a coluna.
const COL: Record<SlotSpec["w"], string> = {
  1: "col-span-1",
  2: "col-span-1 @3xl:col-span-2",
  3: "col-span-1 @3xl:col-span-2 @7xl:col-span-3",
};
const ROW: Record<SlotSpec["h"], string> = { 1: "row-span-1", 2: "row-span-2", 3: "row-span-3", 4: "row-span-4" };

// ------------------------------------------------------------ corpo do slot

function BodyFallback({ err, reset, openVersions }: { err: Error; reset: () => void; openVersions: () => void }) {
  return (
    <ErrorNotice variant="load">
      <ErrorNoticeMessage>Esta peça quebrou: {err.message}</ErrorNoticeMessage>
      <ErrorNoticeAction onClick={reset}>Tentar de novo</ErrorNoticeAction>
      <ErrorNoticeAction onClick={openVersions}>Versões</ErrorNoticeAction>
    </ErrorNotice>
  );
}

function VersionedBody({ spec, openVersions }: { spec: SlotSpec; openVersions: () => void }) {
  const { Comp, error } = useWidget(spec.widget, spec.version);
  if (error)
    return (
      <ErrorNotice variant="load">
        <ErrorNoticeMessage>Esta peça quebrou: {error}</ErrorNoticeMessage>
        <ErrorNoticeAction onClick={openVersions}>Versões</ErrorNoticeAction>
      </ErrorNotice>
    );
  if (!Comp)
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  return (
    <SlotBoundary key={spec.version} fallback={(err, reset) => <BodyFallback err={err} reset={reset} openVersions={openVersions} />}>
      <Comp />
    </SlotBoundary>
  );
}

function BuiltinBody({ Comp, openVersions }: { Comp: ComponentType; openVersions: () => void }) {
  return (
    <SlotBoundary fallback={(err, reset) => <BodyFallback err={err} reset={reset} openVersions={openVersions} />}>
      <Comp />
    </SlotBoundary>
  );
}

// ------------------------------------------------------------ card do slot

/**
 * Card de widget sem cromo. Na troca: anel + selo "versão n" por 2,6 s; tocar no selo abre as versões.
 * `cell`: ocupa a célula da grade (altura da célula, conteúdo rola por dentro); sem ele, segue o fluxo.
 */
export function SlotCard({ spec, cell }: { spec: SlotSpec; cell?: boolean }) {
  const layout = useLayout();
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
  const meta = layout?.collection.find((m) => m.id === spec.widget);
  const Builtin = meta?.source === "builtin" ? BUILTINS[spec.widget] : undefined;
  return (
    <motion.section layout={!reduce} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-slot-id={spec.id} className={cell ? "h-full min-h-0 min-w-0" : "min-w-0"}>
      <Card className={`h-full gap-3 py-4 transition-shadow duration-500 ${cell ? "flex flex-col overflow-hidden" : ""} ${fresh ? "ring-2 ring-x-highlight" : ""}`}>
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {spec.title ?? meta?.title ?? spec.widget}
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
        <CardContent className={`relative px-4 ${cell ? "@container min-h-0 flex-1 overflow-y-auto overscroll-contain" : ""}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={spec.version}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98, filter: "blur(6px)", transition: { duration: 0.2, ease: "easeIn" } }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            >
              {Builtin ? <BuiltinBody Comp={Builtin} openVersions={openVersions} /> : <VersionedBody spec={spec} openVersions={openVersions} />}
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.section>
  );
}

// ------------------------------------------------------------ grade

export function SlotCell({ spec }: { spec: SlotSpec }) {
  return (
    <div className={`min-h-0 min-w-0 ${COL[spec.w] ?? COL[1]} ${ROW[spec.h] ?? ROW[1]}`}>
      <SlotCard spec={spec} cell />
    </div>
  );
}

export function PageGrid({ page }: { page: string }) {
  const layout = useLayout();
  const slots = useSlots(page);
  if (!layout) return <Skeleton className="h-40" />;
  return (
    <div className="@container">
      <div
        className="grid grid-flow-row-dense grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-(--gap) [--cols:1] [--gap:1rem] @3xl:[--cols:2] @7xl:[--cols:3] @7xl:[--gap:1.5rem]"
        style={{ gridAutoRows: "calc((100cqw - (var(--cols) - 1) * var(--gap)) / var(--cols))" }}
      >
        {slots.map((s) => (
          <SlotCell key={s.id} spec={s} />
        ))}
      </div>
    </div>
  );
}

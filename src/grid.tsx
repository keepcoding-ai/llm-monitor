// Grade das páginas `grid`: células quadradas de tamanho igual, só em CSS.
// 1 coluna; 2 a partir de @2xl; 3 a partir de @5xl — container query (não media query), então o
// painel de chat aberto, que estreita o <main>, reduz as colunas sozinho.
// `grid-auto-rows` = largura de uma coluna ⇒ célula 1×1 é quadrada; w/h multiplicam (com os gaps).
import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowsOutCardinal, DotsSixVertical, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
  ErrorNotice, ErrorNoticeAction, ErrorNoticeMessage, Skeleton, ToggleGroup, ToggleGroupItem,
} from "@atrium/core-ui";
import { BUILTINS } from "./builtins";
import { SlotBoundary, useWidget } from "./runtime";
import { removeSlot, reorderSlots, updateSlot, useLayout } from "./sdk";
import { setHash } from "./router";
import type { PageDef, SlotSpec } from "../shared/snapshot";

/** Slots de uma página na ordem do layout. */
export function useSlots(page: string) {
  const layout = useLayout();
  return (layout?.slots ?? []).filter((s) => s.page === page).sort((a, b) => a.order - b.order);
}

// spans com classes estáticas, para o Tailwind enxergar. Em 1 coluna todo widget ocupa a coluna.
const COL: Record<SlotSpec["w"], string> = {
  1: "col-span-1",
  2: "col-span-1 @2xl:col-span-2",
  3: "col-span-1 @2xl:col-span-2 @5xl:col-span-3",
};
const ROW: Record<SlotSpec["h"], string> = { 1: "row-span-1", 2: "row-span-2", 3: "row-span-3", 4: "row-span-4" };
const spanCls = (spec: SlotSpec) => `min-h-0 min-w-0 ${COL[spec.w] ?? COL[1]} ${ROW[spec.h] ?? ROW[1]}`;

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
 * `still`: sem animação de layout (em edição o dnd-kit é quem move a célula).
 */
export function SlotCard({ spec, cell, still }: { spec: SlotSpec; cell?: boolean; still?: boolean }) {
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
    <motion.section layout={!reduce && !still} transition={{ type: "spring", stiffness: 300, damping: 30 }} data-slot-id={spec.id} className={cell ? "h-full min-h-0 min-w-0" : "min-w-0"}>
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
    <div className={spanCls(spec)}>
      <SlotCard spec={spec} cell />
    </div>
  );
}

// ------------------------------------------------------------ edição (modo "Editar página")

type Act = (fn: () => Promise<unknown>) => void;

/** Controles da célula em edição: sobrepõem o card (que fica inerte e esmaecido). Alvos de toque de 44 px. */
function CellControls({ spec, pages, act, handle }: { spec: SlotSpec; pages: PageDef[]; act: Act; handle: ReturnType<typeof useSortable> }) {
  const item = "min-h-11 min-w-11 px-3";
  return (
    <div className="absolute inset-0 z-10 flex flex-col gap-3 overflow-y-auto rounded-xl border-2 border-dashed border-x-highlight bg-background/85 p-3 backdrop-blur-[2px]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={handle.setActivatorNodeRef}
          {...handle.attributes}
          {...handle.listeners}
          aria-label="Arrastar para reordenar"
          className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <DotsSixVertical className="size-6" weight="bold" />
        </button>
        <span className="min-w-0 truncate text-sm font-medium">{spec.title ?? spec.widget}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Largura</span>
          <ToggleGroup type="single" variant="outline" value={String(spec.w)} onValueChange={(v) => v && act(() => updateSlot(spec.id, { w: Number(v) as SlotSpec["w"] }))} aria-label="Largura">
            {[1, 2, 3].map((n) => (
              <ToggleGroupItem key={n} value={String(n)} className={item} aria-label={`Largura ${n}`}>
                {n}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Altura</span>
          <ToggleGroup type="single" variant="outline" value={String(spec.h)} onValueChange={(v) => v && act(() => updateSlot(spec.id, { h: Number(v) as SlotSpec["h"] }))} aria-label="Altura">
            {[1, 2, 3, 4].map((n) => (
              <ToggleGroupItem key={n} value={String(n)} className={item} aria-label={`Altura ${n}`}>
                {n}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-h-11" disabled={pages.length === 0}>
              <ArrowsOutCardinal /> Mover para…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width="content">
            <DropdownMenuLabel>Página de destino</DropdownMenuLabel>
            {pages.map((p) => (
              <DropdownMenuItem key={p.id} className="min-h-11" onSelect={() => act(() => updateSlot(spec.id, { page: p.id }))}>
                {p.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" className="min-h-11 text-x-error" onClick={() => act(() => removeSlot(spec.id))}>
          <Trash /> Remover
        </Button>
      </div>
    </div>
  );
}

function EditableCell({ spec, pages, act }: { spec: SlotSpec; pages: PageDef[]; act: Act }) {
  const sortable = useSortable({ id: spec.id });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`relative ${spanCls(spec)} ${isDragging ? "z-20 opacity-40" : ""}`}>
      <div inert className="h-full select-none opacity-60">
        <SlotCard spec={spec} cell still />
      </div>
      <CellControls spec={spec} pages={pages} act={act} handle={sortable} />
    </div>
  );
}

/** Grade em edição: reordenar por arrastar (otimista, desfaz se a rota falhar), tamanho, mover e remover. */
function EditableGrid({ page, slots, className, style }: { page: string; slots: SlotSpec[]; className: string; style: CSSProperties }) {
  const layout = useLayout();
  const [pending, setPending] = useState<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const realKey = slots.map((s) => s.id).join();
  // a ordem otimista cai quando o layout publicado a alcança (ou, por garantia, em 3 s)
  useEffect(() => {
    if (pending && pending.join() === realKey) setPending(null);
  }, [pending, realKey]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const ordered = pending ? pending.map((id) => slots.find((s) => s.id === id)).filter((s): s is SlotSpec => Boolean(s)) : slots;
  const ids = ordered.map((s) => s.id);
  const others = (layout?.pages ?? []).filter((p) => p.kind === "grid" && p.id !== page);
  const act: Act = (fn) => {
    setErr(null);
    fn().catch((e: Error) => setErr(e.message));
  };
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setPending(next);
    setErr(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending(null), 3000);
    reorderSlots(page, next).catch((er: Error) => {
      if (timer.current) clearTimeout(timer.current);
      setPending(null);
      setErr(`Não consegui salvar a nova ordem: ${er.message}`);
    });
  };
  const active = activeId ? slots.find((s) => s.id === activeId) : undefined;
  return (
    <>
      {err && (
        <ErrorNotice variant="action" className="mb-4">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      {ordered.length === 0 && <p className="mb-4 text-sm text-muted-foreground">Esta página está vazia. Use “Adicionar widget” para trazer peças da coleção.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className={className} style={style}>
            {ordered.map((s) => (
              <EditableCell key={s.id} spec={s} pages={others} act={act} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {active && (
            <Card className="h-full justify-center border-2 border-x-highlight px-4 py-4 shadow-xl">
              <div className="flex items-center gap-2 text-sm font-medium">
                <DotsSixVertical className="size-5 text-muted-foreground" weight="bold" />
                {active.title ?? active.widget}
              </div>
            </Card>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}

export function PageGrid({ page, editing = false }: { page: string; editing?: boolean }) {
  const layout = useLayout();
  const slots = useSlots(page);
  if (!layout) return <Skeleton className="h-40" />;
  const cls = "grid grid-flow-row-dense grid-cols-[repeat(var(--cols),minmax(0,1fr))] gap-(--gap) [--cols:1] [--gap:1rem] @2xl:[--cols:2] @5xl:[--cols:3] @5xl:[--gap:1.5rem]";
  const style = { gridAutoRows: "calc((100cqw - (var(--cols) - 1) * var(--gap)) / var(--cols))" };
  return (
    <div className="@container">
      {editing ? (
        <EditableGrid page={page} slots={slots} className={cls} style={style} />
      ) : (
        <div className={cls} style={style}>
          {slots.map((s) => (
            <SlotCell key={s.id} spec={s} />
          ))}
        </div>
      )}
    </div>
  );
}

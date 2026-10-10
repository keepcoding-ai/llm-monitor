// Gestão de páginas em Ajustes: menu (ordem, nome, ícone, visibilidade), página nova e resumo da coleção.
// Toda mutação publica `layout` por SSE; a ordem otimista cai quando o layout publicado a alcança.
import { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical, Plus, StackSimple, Trash } from "@phosphor-icons/react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Badge, Button, ErrorNotice, ErrorNoticeMessage, Field, FieldLabel, Input, Select, SelectContent, SelectItem, SelectTrigger, Switch,
} from "@atrium/core-ui";
import { iconFor, iconLabel } from "./icons";
import { go, setHash } from "./router";
import { createPage, deletePage, reorderPages, updatePage, useLayout } from "./sdk";
import { ICON_NAMES, type PageDef } from "../shared/snapshot";

type Act = (fn: () => Promise<unknown>) => void;

/** Ícone + rótulo em português, para o seletor. */
function IconOption({ name }: { name: string }) {
  const Icon = iconFor(name);
  return (
    <span className="flex items-center gap-2">
      <Icon className="size-5" /> {iconLabel(name)}
    </span>
  );
}

function IconSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const Icon = iconFor(value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="min-h-11 w-auto gap-2" aria-label={`${label}: ${iconLabel(value)}`}>
        <Icon className="size-5" />
      </SelectTrigger>
      <SelectContent>
        {ICON_NAMES.map((n) => (
          <SelectItem key={n} value={n} className="min-h-11">
            <IconOption name={n} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ------------------------------------------------------------ linha do menu

function PageRow({ page, widgets, act }: { page: PageDef; widgets: number; act: Act }) {
  const sortable = useSortable({ id: page.id });
  const { setNodeRef, transform, transition, isDragging } = sortable;
  const [title, setTitle] = useState(page.title);
  const [askDelete, setAskDelete] = useState(false);
  useEffect(() => setTitle(page.title), [page.title]);
  const commit = () => {
    const t = title.trim();
    if (!t) return setTitle(page.title);
    if (t !== page.title) act(() => updatePage(page.id, { title: t }));
  };
  // Ajustes é o caminho de volta: sem ele no menu o dono se perde
  const locked = page.kind === "settings";
  const switchId = `menu-${page.id}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-2 ${isDragging ? "relative z-10 opacity-60 shadow-lg" : ""}`}
    >
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        aria-label={`Arrastar ${page.title} para reordenar`}
        className="inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <DotsSixVertical className="size-6" weight="bold" />
      </button>
      <IconSelect value={page.icon} onChange={(v) => act(() => updatePage(page.id, { icon: v }))} label={`Ícone de ${page.title}`} />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setTitle(page.title);
        }}
        maxLength={60}
        aria-label={`Nome da página ${page.title}`}
        className="min-h-11 min-w-40 flex-1"
      />
      <div className="ml-auto flex items-center gap-3">
        <div className="flex min-h-11 items-center gap-2">
          <Switch id={switchId} checked={page.menu} disabled={locked} onCheckedChange={(v) => act(() => updatePage(page.id, { menu: v }))} />
          <label htmlFor={switchId} className="text-sm text-muted-foreground">
            No menu
          </label>
        </div>
        {!page.fixed && (
          <Button variant="outline" className="min-h-11 text-x-error" onClick={() => setAskDelete(true)}>
            <Trash /> Apagar
          </Button>
        )}
      </div>
      <AlertDialog open={askDelete} onOpenChange={setAskDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{page.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {widgets === 0 ? "A página está vazia." : `A página tem ${widgets} ${widgets === 1 ? "widget" : "widgets"}, que saem dela.`} Os widgets continuam na coleção.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => act(() => deletePage(page.id))}>
              Apagar página
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

// ------------------------------------------------------------ nova página

function NewPage() {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string>("Star");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    createPage(t, icon)
      .then((p) => {
        setTitle("");
        go(p.id);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <form
      className="flex flex-col gap-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field>
        <FieldLabel htmlFor="nova-pagina">Nova página</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <IconSelect value={icon} onChange={setIcon} label="Ícone da nova página" />
          <Input id="nova-pagina" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Nome da página" className="min-h-11 min-w-40 flex-1" />
          <Button type="submit" className="min-h-11" disabled={!title.trim() || busy}>
            <Plus /> Criar
          </Button>
        </div>
      </Field>
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
    </form>
  );
}

// ------------------------------------------------------------ menu

/** Corpo da seção "Menu": lista arrastável das páginas + formulário de página nova. */
export function MenuAdmin() {
  const layout = useLayout();
  const [pending, setPending] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const pages = [...(layout?.pages ?? [])].sort((a, b) => a.order - b.order);
  const realKey = pages.map((p) => p.id).join();
  useEffect(() => {
    if (pending && pending.join() === realKey) setPending(null);
  }, [pending, realKey]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  if (!layout) return null;
  const ordered = pending ? pending.map((id) => pages.find((p) => p.id === id)).filter((p): p is PageDef => Boolean(p)) : pages;
  const ids = ordered.map((p) => p.id);
  const act: Act = (fn) => {
    setErr(null);
    fn().catch((e: Error) => setErr(e.message));
  };
  const onEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setPending(next);
    setErr(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPending(null), 3000);
    reorderPages(next).catch((e: Error) => {
      if (timer.current) clearTimeout(timer.current);
      setPending(null);
      setErr(`Não consegui salvar a nova ordem: ${e.message}`);
    });
  };
  return (
    <>
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {ordered.map((p) => (
              <PageRow key={p.id} page={p} widgets={layout.slots.filter((s) => s.page === p.id).length} act={act} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <NewPage />
    </>
  );
}

// ------------------------------------------------------------ coleção

const ORIGIN: Record<string, string> = { system: "do sistema", owner: "sua", chat: "criada no chat" };

/** Corpo da seção "Coleção": resumo + atalhos. O painel de adicionar widgets é o `#colecao` (só abre numa página `grid`). */
export function CollectionSummary() {
  const layout = useLayout();
  if (!layout) return null;
  const firstGrid = [...layout.pages].sort((a, b) => a.order - b.order).find((p) => p.kind === "grid");
  const active = (id: string) => layout.slots.find((s) => s.widget === id)?.version ?? layout.versions[id]?.length;
  return (
    <>
      {firstGrid && (
        <Button
          variant="outline"
          className="min-h-11 self-start"
          onClick={() => {
            go(firstGrid.id);
            setHash("colecao");
          }}
        >
          <StackSimple /> Abrir coleção em “{firstGrid.title}”
        </Button>
      )}
      <ul className="flex flex-col divide-y">
        {layout.collection.map((m) => {
          const v = active(m.id);
          return (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{m.title}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Badge tone="muted">{m.source === "builtin" ? "do shell" : (ORIGIN[m.createdBy] ?? m.createdBy)}</Badge>
                  {m.source === "versioned" && v != null && <span>versão {v} no ar</span>}
                </div>
              </div>
              {m.source === "versioned" && (
                <Button variant="outline" size="sm" className="min-h-11 xl:min-h-9" onClick={() => setHash(`versoes/${m.id}`)}>
                  <StackSimple /> Versões
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

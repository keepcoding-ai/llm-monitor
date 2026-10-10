// Coleção de widgets (detour livre `#colecao`): tudo que pode entrar numa página `grid`.
// Celular: drawer inferior; desktop: painel lateral (ResponsivePanel do kit decide pelo `mobile`).
// "Adicionar" cria um slot na página aberta; o que já está nela (builtin) fica desabilitado.
import { useState } from "react";
import { Badge, Button, ErrorNotice, ErrorNoticeMessage, ResponsivePanel } from "@atrium/core-ui";
import { Check, Plus } from "@phosphor-icons/react";
import { addSlot, useLayout } from "./sdk";
import { setHash, useHash, useMedia } from "./router";
import type { PageDef, WidgetMeta } from "../shared/snapshot";

const ORIGIN: Record<WidgetMeta["createdBy"], string> = { system: "do sistema", chat: "criado no chat", owner: "criado por você" };

function CollectionBody({ page }: { page: PageDef }) {
  const layout = useLayout();
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onPage = new Set((layout?.slots ?? []).filter((s) => s.page === page.id).map((s) => s.widget));
  const add = async (m: WidgetMeta) => {
    setBusy(m.id);
    setErr(null);
    try {
      await addSlot(page.id, m.id);
      setAdded(m.id);
      setTimeout(() => setAdded((a) => (a === m.id ? null : a)), 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <ul className="flex flex-col gap-2">
        {(layout?.collection ?? []).map((m) => {
          // peça de código (builtin) é uma só; as versionadas podem se repetir na página
          const already = m.source === "builtin" && onPage.has(m.id);
          return (
            <li key={m.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{m.title}</span>
                <span className="tabular shrink-0 text-sm text-muted-foreground">
                  {m.size.w}×{m.size.h}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone={m.createdBy === "system" ? "muted" : "info"}>{ORIGIN[m.createdBy]}</Badge>
                {already ? (
                  <Button variant="outline" className="min-h-11" disabled>
                    <Check /> já está nesta página
                  </Button>
                ) : (
                  <Button variant="outline" className="min-h-11" disabled={busy === m.id} onClick={() => add(m)}>
                    {added === m.id ? <Check /> : <Plus />} {added === m.id ? "Adicionada" : "Adicionar a esta página"}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Detour `#colecao`: só abre numa página `grid`. */
export function CollectionDetour({ def }: { def: PageDef | undefined }) {
  const hash = useHash();
  const desktop = useMedia("(min-width: 768px)");
  const open = hash === "colecao" && def?.kind === "grid";
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={(o) => !o && setHash("")}
      mobile={!desktop}
      title="Coleção de widgets"
      description={def ? `Escolha o que entra em “${def.title}”.` : "Escolha o que entra na página."}
    >
      {def && open && <CollectionBody page={def} />}
    </ResponsivePanel>
  );
}

// Reserva (plano G4, J4/J5): qual conta usar agora. Claude Code em uso + pools Soul
// com estado, próxima recomendada e ativação (via provider-pool: o segredo nunca
// passa pelo app). Mapear pastas abre por cima e fecha no lugar.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Badge, Button, Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, ErrorNotice, ErrorNoticeMessage, Field, FieldDescription, FieldLabel, Input,
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@atrium/core-ui";
import { FolderSimplePlus, Plus, Trash } from "@phosphor-icons/react";
import { ago, call, usd, useSnapshot } from "../../src/sdk";
import { useMedia } from "../../src/router";
import { recommend } from "../../shared/reserve";

const stateView: Record<string, { label: string; dot: string }> = {
  ok: { label: "com cota", dot: "bg-x-success" },
  quota: { label: "sem cota", dot: "bg-x-alert" },
  auth: { label: "login expirado", dot: "bg-x-error" },
  broken: { label: "quebrada", dot: "bg-x-error" },
};
type PoolCfg = { dir: string; label: string; sessionRoots: string[] };

function MapPools({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wide = useMedia("(min-width: 768px)");
  const [editing, setEditing] = useState<PoolCfg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open && !editing) void call<{ config: { soulPools: PoolCfg[] } }>("/config").then((r) => setEditing(r.config.soulPools));
  }, [open, editing]);
  const close = () => {
    setEditing(null);
    setErr(null);
    onClose();
  };
  const body = editing && (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      {editing.map((p, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
          <Field>
            <FieldLabel>Nome</FieldLabel>
            <Input value={p.label} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          </Field>
          <Field>
            <FieldLabel>Pasta do pool</FieldLabel>
            <Input value={p.dir} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, dir: e.target.value } : x)))} />
          </Field>
          <Field>
            <FieldLabel>Pastas extras com sessões</FieldLabel>
            <Input value={p.sessionRoots.join("; ")} onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, sessionRoots: e.target.value.split(";").map((t) => t.trim()).filter(Boolean) } : x)))} />
            <FieldDescription>Separe por ponto e vírgula. Onde os agentes que usam este pool guardam as conversas.</FieldDescription>
          </Field>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setEditing(editing.filter((_, j) => j !== i))}>
            <Trash /> Remover pool
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditing([...editing, { dir: "", label: "Novo pool", sessionRoots: [] }])}>
          <Plus /> Adicionar pool
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            setErr(null);
            try {
              await call("/config", { method: "PUT", body: { soulPools: editing.filter((p) => p.dir.trim()) } });
              close();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
  const title = "Mapear pastas";
  const desc = "Pools Soul que o monitor acompanha.";
  return wide ? (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{desc}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  ) : (
    <Drawer open={open} onOpenChange={(o) => !o && close()}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{desc}</DrawerDescription>
        </DrawerHeader>
        {body}
      </DrawerContent>
    </Drawer>
  );
}

export default function Reserva() {
  const s = useSnapshot();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mapping, setMapping] = useState(false);
  if (!s) return null;
  const w5 = s.verdict.windows.find((w) => w.id === "5h")?.usedPct;
  const w7 = s.verdict.windows.find((w) => w.id === "7d")?.usedPct;
  const soul7 = s.bySource.find((b) => b.key === "soul");
  const activate = async (dir: string, accountId: string) => {
    setBusy(accountId);
    setErr(null);
    try {
      await call("/control/soul/activate", { body: { dir, accountId } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-5 @3xl:grid-cols-2">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claude Code em uso</h3>
        {s.account ? (
          <>
            <div className="text-base font-medium">{s.account.name || s.account.email}</div>
            <div className="truncate text-sm text-muted-foreground">{s.account.email}</div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma conta conectada no Claude Code.</p>
        )}
        {w5 != null && w7 != null && <div className="tabular text-sm">sessão de 5 h {Math.round(w5)} % · semana {Math.round(w7)} %</div>}
      </section>

      <section className="flex flex-col gap-4">
        {err && (
          <ErrorNotice variant="action">
            <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
          </ErrorNotice>
        )}
        {s.soul.map((p) => {
          const rec = recommend(p);
          return (
            <div key={p.dir} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.label}</h3>
              {!p.ok ? (
                <ErrorNotice variant="load">
                  <ErrorNoticeMessage>Não foi possível ler este pool: {p.error}</ErrorNoticeMessage>
                </ErrorNotice>
              ) : p.accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta neste pool.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {p.accounts.map((a) => {
                    const st = stateView[a.state] ?? { label: a.state, dot: "bg-x-faint" };
                    const isRec = rec.kind === "account" && rec.account.id === a.id;
                    return (
                      <motion.li layout key={a.id} className={`flex min-h-14 items-center gap-3 rounded-md border p-2.5 ${isRec ? "border-x-success" : ""}`}>
                        <span className={`size-2.5 shrink-0 rounded-full ${st.dot}`} role="img" aria-label={st.label} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{a.label}</span>
                            {a.isActive && <Badge tone="success">ativa</Badge>}
                            {isRec && <Badge tone="info">recomendada</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {st.label}
                            {a.resetsAt ? ` · volta ${new Date(a.resetsAt).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                            {a.lastServedAt ? ` · usada ${ago(a.lastServedAt)}` : ""}
                          </div>
                        </div>
                        {!a.isActive && (
                          <Button size="sm" variant={isRec ? "default" : "outline"} disabled={busy !== null || a.state !== "ok"} onClick={() => activate(p.dir, a.id)}>
                            {busy === a.id ? "Ativando…" : "Ativar"}
                          </Button>
                        )}
                      </motion.li>
                    );
                  })}
                </ul>
              )}
              {p.ok && <p className="text-xs text-muted-foreground">{rec.kind === "single" ? "Próxima recomendada: — (só 1 conta no pool)" : rec.kind === "none" ? "Nenhuma outra conta com cota agora." : `Próxima recomendada: ${rec.account.label}.`}</p>}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Soul nos últimos 7 dias: {soul7 ? `${usd(soul7.cost)} em ${soul7.n} turnos` : "nenhum turno nas pastas mapeadas"}. O registro do motor não diz qual conta serviu cada turno; o consumo é do pool.
        </p>
        <Button size="sm" variant="outline" className="self-start" onClick={() => setMapping(true)}>
          <FolderSimplePlus /> Mapear pasta
        </Button>
      </section>
      <MapPools open={mapping} onClose={() => setMapping(false)} />
    </div>
  );
}

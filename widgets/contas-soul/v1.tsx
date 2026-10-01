// Contas Soul: pools mapeados, contas pela API do provider-pool (segredo nunca
// aparece), ativação de conta e mapeamento de pastas.
import { useState } from "react";
import { Badge, Button, ErrorNotice, ErrorNoticeMessage, Field, FieldDescription, FieldLabel, Input } from "@atrium/core-ui";
import { Plus, Trash } from "@phosphor-icons/react";
import { ago, call, hhmm, usd, useSnapshot } from "../../src/sdk";

// saúde da conta colorida por intenção
const stateView: Record<string, { label: string; dot: string }> = {
  ok: { label: "saudável", dot: "bg-x-success" },
  quota: { label: "cota estourada", dot: "bg-x-alert" },
  auth: { label: "login expirado", dot: "bg-x-error" },
  broken: { label: "quebrada", dot: "bg-x-error" },
};

type PoolCfg = { dir: string; label: string; sessionRoots: string[] };

export default function ContasSoul() {
  const s = useSnapshot();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<PoolCfg[] | null>(null);
  if (!s) return null;

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
  const startEdit = async () => {
    const r = await call<{ config: { soulPools: PoolCfg[] } }>("/config");
    setEditing(r.config.soulPools);
  };
  const saveEdit = async () => {
    if (!editing) return;
    setErr(null);
    try {
      await call("/config", { method: "PUT", body: { soulPools: editing.filter((p) => p.dir.trim()) } });
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const soulToday = s.bySource.find((b) => b.key === "soul");
  return (
    <div className="flex flex-col gap-4">
      {err && (
        <ErrorNotice variant="action">
          <ErrorNoticeMessage>{err}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      {s.soul.map((p) => (
        <div key={p.dir} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{p.label}</span>
            <span className="text-xs text-muted-foreground">{p.sessionFiles} {p.sessionFiles === 1 ? "sessão" : "sessões"} com consumo</span>
          </div>
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
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-md border p-2.5">
                    <span className={`size-2.5 shrink-0 rounded-full ${st.dot}`} role="img" aria-label={st.label} title={st.label} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{a.label}</span>
                        {a.isActive && <Badge tone="success">ativa</Badge>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {a.kind === "oauth" ? "login" : "chave"} · {st.label}
                        {a.resetsAt ? ` · volta às ${hhmm(a.resetsAt)}` : ""}
                        {a.lastServedAt ? ` · usada ${ago(a.lastServedAt)}` : ""}
                      </div>
                    </div>
                    {!a.isActive && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => activate(p.dir, a.id)}>
                        {busy === a.id ? "Ativando…" : "Ativar"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Consumo do Soul em 7 dias: {soulToday ? `${usd(soulToday.cost)} em ${soulToday.n} turnos` : "nenhum turno registrado nas pastas mapeadas"}. O registro do motor não diz qual conta serviu cada turno; o consumo é atribuído ao pool.
      </p>
      {editing ? (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          {editing.map((p, i) => (
            <div key={i} className="flex flex-col gap-2">
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
                <Input
                  value={p.sessionRoots.join("; ")}
                  onChange={(e) => setEditing(editing.map((x, j) => (j === i ? { ...x, sessionRoots: e.target.value.split(";").map((t) => t.trim()).filter(Boolean) } : x)))}
                />
                <FieldDescription>Separe por ponto e vírgula. Onde agentes que usam este pool guardam as conversas.</FieldDescription>
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
            <Button size="sm" onClick={saveEdit}>Salvar</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="self-start" onClick={startEdit}>
          Mapear pastas
        </Button>
      )}
    </div>
  );
}

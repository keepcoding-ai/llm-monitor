// Sessões agora: quanto cada sessão do Claude Code gastou nos últimos 30 min.
import { Stat } from "../../src/ui";
import { ago, modelName, usd, tokens, useSnapshot } from "../../src/sdk";

export default function SessoesAgora() {
  const s = useSnapshot();
  if (!s) return null;
  const rows = s.bySessionRecent;
  if (!rows) {
    return (
      <p className="text-sm text-muted-foreground">Aguardando o servidor carregar os dados por sessão.</p>
    );
  }
  const vivas = rows.filter((r) => r.viva);
  const custoVivas = vivas.reduce((acc, r) => acc + r.cost, 0);
  const encerradas = rows.length - vivas.length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Stat
        label="Abertas agora"
        value={usd(custoVivas)}
        hint={
          vivas.length
            ? `${vivas.length} sessões abertas${encerradas ? ` · ${encerradas} encerradas nos últimos 30 min` : ""}`
            : encerradas
              ? `Nenhuma aberta · ${encerradas} encerrada(s) nos últimos 30 min`
              : "Nenhuma sessão nos últimos 30 min"
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma sessão respondeu nos últimos 30 min.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {rows.map((r) => (
              <li key={r.session} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${r.viva ? "bg-x-success" : "bg-muted-foreground/40"}`}
                    aria-label={r.viva ? "aberta" : "encerrada"}
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.session.slice(0, 8)} · {r.project}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.models.map((m) => modelName(m)).join(", ")} · {r.n} resp. · {tokens(r.cacheRead)} em cache de leitura · {ago(r.lastAt)}
                    </div>
                  </div>
                </div>
                <span className="shrink-0 tabular-nums font-semibold">{usd(r.cost)}</span>
              </li>
          ))}
        </ul>
      )}
    </div>
  );
}

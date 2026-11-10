// Sessões agora: quanto cada sessão do Claude Code gastou nos últimos 30 min.
import { Stat } from "../../src/ui";
import { ago, modelName, usd, tokens, useSnapshot } from "../../src/sdk";

const ATIVA_ATE_MS = 3 * 60_000;

export default function SessoesAgora() {
  const s = useSnapshot();
  if (!s) return null;
  const rows = s.bySessionRecent;
  if (!rows) {
    return (
      <p className="text-sm text-muted-foreground">Aguardando o servidor carregar os dados por sessão.</p>
    );
  }
  const total = rows.reduce((acc, r) => acc + r.cost, 0);
  const agora = new Date(s.at).getTime();
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Stat
        label="Últimos 30 min"
        value={usd(total)}
        hint={rows.length ? `${rows.length} sessões, ${rows.reduce((acc, r) => acc + r.n, 0)} respostas` : "Nenhuma sessão ativa"}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma sessão respondeu nos últimos 30 min.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {rows.map((r) => {
            const ativa = agora - new Date(r.lastAt).getTime() < ATIVA_ATE_MS;
            return (
              <li key={r.session} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`size-2 shrink-0 rounded-full ${ativa ? "bg-x-success" : "bg-muted-foreground/40"}`}
                    aria-label={ativa ? "ativa" : "parada"}
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
            );
          })}
        </ul>
      )}
    </div>
  );
}

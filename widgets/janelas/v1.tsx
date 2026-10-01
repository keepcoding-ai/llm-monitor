// Janelas de 5 h da semana (D9): onde houve aperto e onde sobrou folga para o pesado.
import { Badge } from "@atrium/core-ui";
import { usd, useSnapshot } from "../../src/sdk";

const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const hh = (iso: string) => String(new Date(iso).getHours()).padStart(2, "0");

export default function Janelas() {
  const s = useSnapshot();
  if (!s) return null;
  const ws = [...s.semana.windows].reverse();
  if (!ws.length) return <p className="text-sm text-muted-foreground">Nenhuma janela de 5 h nesta semana ainda.</p>;
  const max = Math.max(...ws.map((w) => w.cost), 1e-9);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5">
        {ws.map((w) => (
          <li key={w.start} className="grid min-h-8 grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm" data-slack={w.slack || undefined}>
            <span className="tabular text-muted-foreground">{DAYS[new Date(w.start).getDay()]} {hh(w.start)}–{hh(w.end)}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${w.slack ? "bg-x-success" : "bg-foreground/40"}`} style={{ width: `${Math.max(2, (w.cost / max) * 100)}%` }} />
            </span>
            <span className="tabular flex min-w-20 items-center justify-end gap-1.5">
              {w.active ? <Badge tone="info">agora</Badge> : w.slack ? <Badge tone="success">folga</Badge> : null}
              {usd(w.cost, 0)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{s.semana.slackBelow != null ? `Folga = janela abaixo de ${usd(s.semana.slackBelow, 0)}, o quarto mais leve das suas janelas em 4 semanas.` : "A marca de folga aparece com 4 semanas de histórico."}</p>
    </div>
  );
}

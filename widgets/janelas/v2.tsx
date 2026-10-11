// Janelas de 5 h da semana (D9): onde houve aperto e onde sobrou folga para o pesado.
// v2 — ocupa a célula e se revela pela altura dela:
//   corpo baixo → a janela de agora, quantas tiveram folga e as janelas em colunas (estica na altura);
//   tall-md     → entra a lista, da mais nova para a mais antiga (ela rola por dentro se for longa);
//   tall-lg     → explicação do que é folga.
import { Badge } from "@atrium/core-ui";
import { usd, useSnapshot } from "../../src/sdk";

const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const hh = (iso: string) => String(new Date(iso).getHours()).padStart(2, "0");

export default function Janelas() {
  const s = useSnapshot();
  if (!s) return null;
  const chrono = s.semana.windows;
  if (!chrono.length) return <p className="text-sm text-muted-foreground">Nenhuma janela de 5 h nesta semana ainda.</p>;
  const newest = [...chrono].reverse();
  const max = Math.max(...chrono.map((w) => w.cost), 1e-9);
  const active = chrono.find((w) => w.active);
  const slack = chrono.filter((w) => w.slack).length;
  const tone = (w: (typeof chrono)[number]) => (w.slack ? "bg-x-success" : w.active ? "bg-foreground" : "bg-foreground/40");
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span>
          {active ? (
            <>
              <span className="text-muted-foreground">Agora</span> <span className="tabular font-semibold">{usd(active.cost, 0)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Nenhuma janela aberta agora</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full bg-x-success" aria-hidden />
          {slack === 0 ? "nenhuma com folga" : `${slack} de ${chrono.length} com folga`}
        </span>
      </p>

      {/* the week in columns, oldest on the left: grows with the cell and shrinks to make room for the list */}
      <div className="flex min-h-12 flex-[1_1_3rem] flex-col gap-1 tall-md:min-h-20" role="img" aria-label={`${chrono.length} janelas de 5 h nesta semana; ${slack} com folga.`}>
        <div className="flex min-h-0 flex-1 items-end gap-1">
          {chrono.map((w) => (
            <span key={w.start} className="flex h-full min-w-0 flex-1 items-end" title={`${DAYS[new Date(w.start).getDay()]} ${hh(w.start)}–${hh(w.end)} · ${usd(w.cost, 0)}${w.slack ? " · folga" : ""}`}>
              <span className={`block w-full rounded-t-sm ${tone(w)}`} style={{ height: `${Math.max(4, (w.cost / max) * 100)}%` }} />
            </span>
          ))}
        </div>
        <div className="flex gap-1 text-[10px] leading-none text-muted-foreground" aria-hidden>
          {chrono.map((w, i) => {
            const day = new Date(w.start).getDay();
            const first = i === 0 || new Date(chrono[i - 1].start).getDay() !== day;
            return (
              <span key={w.start} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                {first ? DAYS[day] : ""}
              </span>
            );
          })}
        </div>
      </div>

      <ul className="hidden min-h-0 flex-[0_1_auto] flex-col gap-1 overflow-y-auto overscroll-contain border-t pt-2 tall-md:flex" data-scroll="lista">
        {newest.map((w) => (
          <li key={w.start} className="grid min-h-7 shrink-0 grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm" data-slack={w.slack || undefined}>
            <span className="tabular text-muted-foreground">
              {DAYS[new Date(w.start).getDay()]} {hh(w.start)}–{hh(w.end)}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${tone(w)}`} style={{ width: `${Math.max(2, (w.cost / max) * 100)}%` }} />
            </span>
            <span className="tabular flex min-w-20 items-center justify-end gap-1.5">
              {w.active ? <Badge tone="info">agora</Badge> : w.slack ? <Badge tone="success">folga</Badge> : null}
              {usd(w.cost, 0)}
            </span>
          </li>
        ))}
      </ul>

      <p className="hidden text-xs text-muted-foreground tall-lg:block">
        {s.semana.slackBelow != null ? `Folga = janela abaixo de ${usd(s.semana.slackBelow, 0)}, o quarto mais leve das suas janelas em 4 semanas.` : "A marca de folga aparece com 4 semanas de histórico."}
      </p>
    </div>
  );
}

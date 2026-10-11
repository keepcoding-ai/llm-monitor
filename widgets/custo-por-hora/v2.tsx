// Custo por hora das últimas 12 h, em barras verticais.
// v2 — ocupa a célula: as barras esticam para preencher a altura; o valor em cima de cada
// barra aparece quando há altura (tall-sm).
import { usd, useSnapshot } from "../../src/sdk";

export default function CustoPorHora() {
  const s = useSnapshot();
  if (!s) return null;
  const hs = s.hourly.slice(-12);
  if (!hs.length) return <p className="text-sm text-muted-foreground">Sem consumo nas últimas 12 h.</p>;
  const max = Math.max(...hs.map((h) => h.cost), 1e-9);
  const total = hs.reduce((a, h) => a + h.cost, 0);
  const hour = (iso: string) => `${new Date(iso).getHours()}h`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 tall-sm:gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-muted-foreground">Últimas 12 h</span>
        <span className="tabular text-sm font-semibold">{usd(total, 0)}</span>
      </div>
      <div className="flex min-h-10 flex-1 items-end gap-1.5" role="img" aria-label={`Custo por hora das últimas 12 horas: ${usd(total, 0)} no total.`}>
        {hs.map((h) => (
          <div key={h.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${hour(h.hour)} · ${usd(h.cost)}`}>
            <span className="tabular hidden text-[10px] leading-none text-muted-foreground tall-sm:block">{h.cost >= 1 ? usd(h.cost, 0) : ""}</span>
            <span className="block min-h-0.5 w-full rounded-t bg-foreground/40" style={{ flex: `0 1 ${Math.max(2, (h.cost / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="tabular flex justify-between text-[10px] leading-none text-muted-foreground">
        <span>{hour(hs[0].hour)}</span>
        <span>{hour(hs[hs.length - 1].hour)}</span>
      </div>
    </div>
  );
}

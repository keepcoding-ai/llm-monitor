// Custo por hora das últimas 12 h, em barras verticais.
import { usd, useSnapshot } from "../../src/sdk";

export default function CustoPorHora() {
  const s = useSnapshot();
  if (!s) return null;
  const hs = s.hourly.slice(-12);
  const max = Math.max(...hs.map((h) => h.cost), 1e-9);
  const total = hs.reduce((a, h) => a + h.cost, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-xs text-muted-foreground">Últimas 12 h</span>
        <span className="tabular text-sm font-semibold">{usd(total, 0)}</span>
      </div>
      <div className="flex h-28 items-end gap-1.5">
        {hs.map((h) => (
          <div key={h.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${new Date(h.hour).getHours()}h · ${usd(h.cost)}`}>
            <span className="tabular text-[10px] text-muted-foreground">{h.cost >= 1 ? usd(h.cost, 0) : ""}</span>
            <span className="block w-full rounded-t bg-foreground/40" style={{ height: `${Math.max(2, (h.cost / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] tabular text-muted-foreground">
        <span>{new Date(hs[0]?.hour ?? 0).getHours()}h</span>
        <span>{new Date(hs[hs.length - 1]?.hour ?? 0).getHours()}h</span>
      </div>
    </div>
  );
}

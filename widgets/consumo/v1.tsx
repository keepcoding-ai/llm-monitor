// Consumo no tempo: últimas 48 h por família de modelo, ou 30 dias.
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { usd, useSnapshot } from "../../src/sdk";
import { Legend, StackedBars, Stat } from "../../src/ui";

const FAM: Record<string, { label: string; color: string }> = {
  opus: { label: "Opus", color: "var(--x-purple)" },
  sonnet: { label: "Sonnet", color: "var(--x-sky)" },
  haiku: { label: "Haiku", color: "var(--x-teal)" },
  fable: { label: "Fable", color: "var(--x-magenta)" },
};
const colorOf = (k: string) => FAM[k]?.color ?? "var(--x-faint)";

export default function Consumo() {
  const s = useSnapshot();
  const [range, setRange] = useState<"48h" | "30d">("48h");
  if (!s) return null;
  const keys = [...new Set(s.hourly.flatMap((h) => Object.keys(h.byModel)))];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-6">
          <Stat label="Hoje" value={usd(s.today.cost)} hint={`${s.today.n.toLocaleString("pt-BR")} respostas`} />
          <Stat label="7 dias" value={usd(s.week.cost)} />
        </div>
        <ToggleGroup type="single" value={range} onValueChange={(v: string) => v && setRange(v as "48h" | "30d")} variant="outline" size="sm">
          <ToggleGroupItem value="48h">48 h</ToggleGroupItem>
          <ToggleGroupItem value="30d">30 dias</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {range === "48h" ? (
        <>
          <StackedBars
            data={s.hourly.map((h) => ({ x: h.hour, parts: h.byModel }))}
            keys={keys}
            color={colorOf}
            label={(x) => new Date(x).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
            format={(n) => usd(n)}
          />
          <Legend items={keys.map((k) => ({ key: k, label: FAM[k]?.label ?? k, color: colorOf(k) }))} />
        </>
      ) : (
        <StackedBars
          data={s.daily.map((d) => ({ x: d.day, parts: { total: d.cost } }))}
          keys={["total"]}
          color={() => "var(--x-blue)"}
          label={(x) => new Date(x).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
          format={(n) => usd(n)}
        />
      )}
      <p className="text-xs text-muted-foreground">Custo equivalente API (tabela {s.collector.priceTable}); a assinatura não cobra por token.</p>
    </div>
  );
}

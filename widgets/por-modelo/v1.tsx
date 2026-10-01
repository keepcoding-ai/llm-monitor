// Por modelo: ranking de custo hoje / 7 dias, com parcela de subagentes.
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { modelColor, modelName, pct, tokens, usd, useSnapshot } from "../../src/sdk";
import { RankList } from "../../src/ui";

export default function PorModelo() {
  const s = useSnapshot();
  const [range, setRange] = useState<"hoje" | "7d">("hoje");
  if (!s) return null;
  const rows = range === "hoje" ? s.byModel : s.byModelWeek;
  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup type="single" value={range} onValueChange={(v: string) => v && setRange(v as "hoje" | "7d")} variant="outline" size="sm" className="self-start">
        <ToggleGroupItem value="hoje">Hoje</ToggleGroupItem>
        <ToggleGroupItem value="7d">7 dias</ToggleGroupItem>
      </ToggleGroup>
      <RankList
        color={modelColor}
        rows={rows.slice(0, 6).map((m) => ({ key: m.key, label: modelName(m.key), value: m.cost, display: usd(m.cost), sub: `${tokens(m.total)} tokens · ${tokens(m.thinking)} de raciocínio` }))}
      />
      {range === "hoje" && s.today.cost > 0 && (
        <p className="text-xs text-muted-foreground">
          Subagentes: {pct(s.sidechainToday.share)} do custo de hoje ({pct(s.sidechainToday.opusShare)} em opus).
        </p>
      )}
    </div>
  );
}

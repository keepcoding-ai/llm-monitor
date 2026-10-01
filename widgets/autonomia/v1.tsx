// Autonomia: quanto fôlego resta no ritmo atual. Usa os limites da statusline
// quando há; sem eles mostra só tendência e diz por quê.
import { Alert, AlertDescription, AlertTitle } from "@atrium/core-ui";
import { Info } from "@phosphor-icons/react";
import { hhmm, tokens, usd, useSnapshot } from "../../src/sdk";
import { Meter, Stat } from "../../src/ui";

export default function Autonomia() {
  const s = useSnapshot();
  if (!s) return null;
  const a = s.autonomy;
  const act = s.windows.find((w) => w.active);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-medium leading-snug tv:text-lg">{a.verdict}</p>
      {a.basis === "limits" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Meter value={a.usedPct} label="Janela de 5 h" sub={a.resetsAt ? `reseta às ${hhmm(a.resetsAt)}` : undefined} />
          <Stat label="Ritmo" value={`${a.ratePctPerHour.toFixed(1)}%/h`} />
          <Stat label="Bate o limite" value={a.hitsAt ? hhmm(a.hitsAt) : "—"} tone={a.hitsAt && a.resetsAt && a.hitsAt < a.resetsAt ? "alert" : undefined} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Última hora" value={tokens(a.tokensPerHourNow)} hint="tokens (sem cache lido)" />
            <Stat label="Média por hora ativa" value={tokens(a.tokensPerHourAvg)} hint="7 dias" />
            <Stat label="Hoje" value={usd(s.today.cost)} hint="equivalente API" />
            <Stat label="Janela atual (estimada)" value={act ? usd(act.cost) : "—"} hint={act ? `até ${hhmm(act.end)}` : "sem janela aberta"} />
          </div>
          <Alert tone="info">
            <Info />
            <AlertTitle>Sem limites do plano</AlertTitle>
            <AlertDescription>{a.reason}</AlertDescription>
          </Alert>
        </>
      )}
    </div>
  );
}

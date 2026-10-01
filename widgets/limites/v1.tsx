// Limites do plano (5 h e semana) vindos da statusline do Claude Code.
// Sem snapshot: diz claramente — nunca inventa número.
import { Alert, AlertDescription, AlertTitle } from "@atrium/core-ui";
import { WarningCircle } from "@phosphor-icons/react";
import { ago, hhmm, useSnapshot } from "../../src/sdk";
import { Meter } from "../../src/ui";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "horário não informado");

export default function Limites() {
  const s = useSnapshot();
  if (!s) return null;
  const l = s.limits;
  if (l.state === "missing")
    return (
      <Alert tone="warning">
        <WarningCircle />
        <AlertTitle>Limites indisponíveis</AlertTitle>
        <AlertDescription>{l.reason}</AlertDescription>
      </Alert>
    );
  return (
    <div className="flex flex-col gap-4">
      {l.fiveHour && <Meter value={l.fiveHour.usedPct} label="Janela de 5 h" sub={`reseta às ${l.fiveHour.resetsAt ? hhmm(l.fiveHour.resetsAt) : "?"}`} />}
      {l.sevenDay && <Meter value={l.sevenDay.usedPct} label="Semana" sub={`reseta ${when(l.sevenDay.resetsAt)}`} />}
      <p className="text-xs text-muted-foreground">{l.state === "stale" ? l.reason : `Atualizado ${ago(l.at)} pela statusline.`}</p>
    </div>
  );
}

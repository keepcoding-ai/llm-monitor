// Toggle "Análises automáticas" (o pulso periódico do LLM). Um componente só,
// usado em Ajustes → Plataforma e no veredito (perto das barras de cota).
// Lê o estado do snapshot (SSE) e grava em PUT /auto-analysis.
import { useState } from "react";
import { Field, FieldDescription, FieldLabel, Spinner, ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { call, useSnapshot } from "./sdk";

const label = (model: string | undefined) => `Análises automáticas (${model ? model[0].toUpperCase() + model.slice(1) : "Haiku"})`;
export const AUTO_ANALYSIS_HINT = "Turnos periódicos de LLM que examinam o estado. Desligar evita gasto quando a cota está crítica; o chat e o “Pulsar agora” continuam funcionando.";

export function AutoAnalysisToggle({ model, compact = false }: { model?: string; compact?: boolean }) {
  const s = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!s) return null;
  const enabled = s.pulse.enabled;
  const set = async (v: string) => {
    if (!v || (v === "on") === enabled) return;
    setBusy(true);
    setErr(null);
    try {
      await call("/auto-analysis", { method: "PUT", body: { enabled: v === "on" } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const group = (
    <ToggleGroup type="single" value={enabled ? "on" : "off"} onValueChange={set} disabled={busy} variant="outline" size="sm" className="justify-start" aria-label={label(model)}>
      <ToggleGroupItem value="on">Ligadas</ToggleGroupItem>
      <ToggleGroupItem value="off">Desligadas</ToggleGroupItem>
    </ToggleGroup>
  );
  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="text-muted-foreground">{label(model)}</span>
        {group}
        {busy && <Spinner />}
        <span className="basis-full text-xs text-muted-foreground">{enabled ? "Desligue para não gastar cota com análises enquanto ela está apertada." : "Desligadas: o monitor não gasta LLM sozinho."}</span>
        {err && <span className="basis-full text-xs text-x-error">{err}</span>}
      </div>
    );
  return (
    <Field>
      <FieldLabel>{label(model)}</FieldLabel>
      <div className="flex items-center gap-2">
        {group}
        {busy && <Spinner />}
      </div>
      <FieldDescription>{AUTO_ANALYSIS_HINT}</FieldDescription>
      {err && <p className="text-xs text-x-error">{err}</p>}
    </Field>
  );
}

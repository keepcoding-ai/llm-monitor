// Controle: modelo e effort padrão do Claude Code (grava settings.json só ao
// clicar em Aplicar; backup antes) e ajustes da própria plataforma.
import { useEffect, useState } from "react";
import { Button, ErrorNotice, ErrorNoticeMessage, Field, FieldDescription, FieldLabel, Input, ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { Check } from "@phosphor-icons/react";
import { call, modelName, usd, useSnapshot } from "../../src/sdk";

const PADRAO = "__padrao__";

export default function Controle() {
  const s = useSnapshot();
  const [model, setModel] = useState<string>(PADRAO);
  const [effort, setEffort] = useState<string>(PADRAO);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulseMin, setPulseMin] = useState("");
  const [budget, setBudget] = useState("");

  useEffect(() => {
    if (!s) return;
    setModel(s.settings.model ?? PADRAO);
    setEffort(s.settings.effortLevel ?? PADRAO);
  }, [s?.settings.model, s?.settings.effortLevel]);
  useEffect(() => {
    call<{ config: { pulse: { everyMinutes: number }; platformDailyBudgetUSD: number } }>("/config").then((r) => {
      setPulseMin(String(r.config.pulse.everyMinutes));
      setBudget(String(r.config.platformDailyBudgetUSD));
    });
  }, []);
  if (!s) return null;

  const dirty = (s.settings.model ?? PADRAO) !== model || (s.settings.effortLevel ?? PADRAO) !== effort;
  const aliases = s.catalog.models.filter((m) => !m.startsWith("claude-"));
  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await call("/control/claude", { body: { model: model === PADRAO ? null : model, effortLevel: effort === PADRAO ? null : effort } });
      setMsg({ ok: true, text: "Gravado. Vale para as próximas sessões do Claude Code; a cópia anterior ficou guardada." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const savePlatform = async () => {
    setMsg(null);
    try {
      await call("/config", { method: "PUT", body: { pulse: { everyMinutes: Math.max(5, Number(pulseMin) || 60) }, platformDailyBudgetUSD: Math.max(0, Number(budget) || 0) } });
      setMsg({ ok: true, text: "Ajustes da plataforma salvos." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {s.settings.error && (
        <ErrorNotice variant="load">
          <ErrorNoticeMessage>Não consegui ler as configurações do Claude Code: {s.settings.error}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <Field>
        <FieldLabel>Modelo padrão do Claude Code</FieldLabel>
        <ToggleGroup type="single" value={model} onValueChange={(v: string) => v && setModel(v)} variant="outline" size="sm" className="flex-wrap justify-start">
          <ToggleGroupItem value={PADRAO}>Padrão do plano</ToggleGroupItem>
          {aliases.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>Modelos vistos nos seus dados: {s.catalog.models.filter((m) => m.startsWith("claude-")).map(modelName).join(", ") || "nenhum"}.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Esforço padrão</FieldLabel>
        <ToggleGroup type="single" value={effort} onValueChange={(v: string) => v && setEffort(v)} variant="outline" size="sm" className="flex-wrap justify-start">
          <ToggleGroupItem value={PADRAO}>Padrão</ToggleGroupItem>
          {s.catalog.efforts.map((e) => (
            <ToggleGroupItem key={e} value={e}>
              {e}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Button disabled={!dirty || busy} onClick={apply} className="self-start">
        <Check /> {busy ? "Gravando…" : "Aplicar no Claude Code"}
      </Button>

      <div className="grid grid-cols-2 gap-3 border-t pt-4">
        <Field>
          <FieldLabel>Pulso a cada (min)</FieldLabel>
          <Input inputMode="numeric" value={pulseMin} onChange={(e) => setPulseMin(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel>Teto diário da plataforma (US$)</FieldLabel>
          <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <p className="col-span-2 text-xs text-muted-foreground">
          A plataforma gastou {usd(s.platform.todayCost)} hoje em {s.platform.calls} {s.platform.calls === 1 ? "chamada" : "chamadas"} (pulso e chat).
        </p>
        <Button size="sm" variant="outline" className="col-span-2 justify-self-start" onClick={savePlatform}>
          Salvar ajustes
        </Button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-x-success" : "text-x-error"}`}>{msg.text}</p>}
    </div>
  );
}

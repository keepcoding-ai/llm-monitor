// Ajustes (fixo no shell, plano §2/§9.2): Claude Code, linha de status, Fable
// manual, plataforma (pulso/teto), notificações, tema e versões dos widgets.
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, CodeBlock, Collapsible, CollapsibleContent, CollapsibleTrigger, ErrorNotice, ErrorNoticeMessage, Field, FieldDescription, FieldLabel, Input, Spinner, ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { ArrowFatLinesUp, CaretDown, Check, Heartbeat, StackSimple } from "@phosphor-icons/react";
import { ThemeToggle } from "../theme";
import { ago, call, modelName, usd, useLayout, useLive, useSnapshot } from "../sdk";
import { setHash } from "../router";
import { NotifySetting } from "../notify";
import type { PulseRecord } from "../../shared/snapshot";

const PADRAO = "__padrao__";

/** O pulso escreve livre; a tela nunca mostra caminho de pasta — fica só o nome final. */
const noPaths = (t: string) => t.replace(/\b[A-Za-z]:[\\/][^\s,;)]*/g, (m) => m.split(/[\\/]/).filter(Boolean).pop() ?? m);

export function Section({ title, desc, children, id }: { title: string; desc?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <Card className="gap-4 py-5" id={id}>
      <CardHeader className="px-5">
        <CardTitle className="text-base">{title}</CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-5">{children}</CardContent>
    </Card>
  );
}

type Cfg = { pulse: { enabled: boolean; everyMinutes: number; model: string; autoEscalate: boolean }; platformDailyBudgetUSD: number; chatModel: string };

/** Preço típico de uma ação que custa LLM: mediana do custo real das últimas execuções. */
export function typical(costs: (number | null | undefined)[]): number | null {
  const c = costs.filter((x): x is number => typeof x === "number").slice(-20).sort((a, b) => a - b);
  return c.length ? c[Math.floor(c.length / 2)] : null;
}

function ClaudeDefaults() {
  const s = useSnapshot();
  const [model, setModel] = useState(PADRAO);
  const [effort, setEffort] = useState(PADRAO);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!s) return;
    setModel(s.settings.model ?? PADRAO);
    setEffort(s.settings.effortLevel ?? PADRAO);
  }, [s?.settings.model, s?.settings.effortLevel]);
  if (!s) return null;
  const dirty = (s.settings.model ?? PADRAO) !== model || (s.settings.effortLevel ?? PADRAO) !== effort;
  const aliases = s.catalog.models.filter((m) => !m.startsWith("claude-"));
  return (
    <Section title="Claude Code" desc="Modelo e esforço padrão das próximas sessões. Grava só quando você aplica, e guarda uma cópia do arquivo antes.">
      {s.settings.error && (
        <ErrorNotice variant="load">
          <ErrorNoticeMessage>Não consegui ler as configurações do Claude Code: {s.settings.error}</ErrorNoticeMessage>
        </ErrorNotice>
      )}
      <Field>
        <FieldLabel>Modelo padrão</FieldLabel>
        <ToggleGroup type="single" value={model} onValueChange={(v: string) => v && setModel(v)} variant="outline" size="sm" className="flex-wrap justify-start">
          <ToggleGroupItem value={PADRAO}>Padrão do plano</ToggleGroupItem>
          {aliases.map((m) => (
            <ToggleGroupItem key={m} value={m}>{m}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>Modelos vistos nos seus dados: {s.catalog.models.filter((m) => m.startsWith("claude-")).map(modelName).join(", ") || "nenhum"}.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel>Esforço padrão</FieldLabel>
        <ToggleGroup type="single" value={effort} onValueChange={(v: string) => v && setEffort(v)} variant="outline" size="sm" className="flex-wrap justify-start">
          <ToggleGroupItem value={PADRAO}>Padrão</ToggleGroupItem>
          {s.catalog.efforts.map((e) => (
            <ToggleGroupItem key={e} value={e}>{e}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!dirty || busy}
          className="w-full md:w-auto"
          onClick={async () => {
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
          }}
        >
          <Check /> {busy ? "Gravando…" : "Aplicar — com cópia de segurança"}
        </Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-x-success" : "text-x-error"}`}>{msg.text}</span>}
      </div>
    </Section>
  );
}

function StatusLineSetup() {
  const s = useSnapshot();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !snippet) call<{ snippet: string }>("/setup/statusline").then((r) => setSnippet(r.snippet));
  }, [open, snippet]);
  if (!s) return null;
  const v = s.verdict;
  const state = v.state === "missing" ? { t: "não ativa", tone: "warning" as const } : v.state === "stale" ? { t: "parada", tone: "warning" as const } : { t: "ativa", tone: "success" as const };
  return (
    <Section id="linha-de-status" title="Linha de status" desc="É por ela que o Claude Code entrega o % oficial da sessão de 5 h e da semana — sem ela não há veredito, só tendência.">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={state.tone}>{state.t}</Badge>
        <span className="text-muted-foreground">{v.readAt ? `última leitura ${ago(v.readAt)}` : "nenhuma leitura ainda"}</span>
      </div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="self-start px-2">
            <CaretDown className={`transition-transform ${open ? "rotate-180" : ""}`} /> Como ativar
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          <p className="text-sm text-muted-foreground">Acrescente este trecho às configurações do Claude Code (o monitor não faz isso por você) e abra uma sessão nova:</p>
          {snippet ? <CodeBlock code={snippet} wrap /> : <Spinner />}
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

function Platform() {
  const s = useSnapshot();
  const running = useLive((x) => x.pulseRunning || Boolean(x.snapshot?.pulse.running));
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [pulses, setPulses] = useState<PulseRecord[]>([]);
  const [proposals, setProposals] = useState<{ model: string; costUSD: number | null }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [esc, setEsc] = useState<string | null>(null);
  const [escBusy, setEscBusy] = useState(false);
  useEffect(() => {
    call<{ config: Cfg }>("/config").then((r) => setCfg(r.config));
    call<PulseRecord[]>("/pulses").then(setPulses, () => undefined);
    call<{ model: string; costUSD: number | null }[]>("/proposals").then(setProposals, () => undefined);
  }, [s?.pulse.lastAt]);
  if (!s || !cfg) return null;
  const save = async (patch: Partial<Cfg>) => {
    setMsg(null);
    try {
      const r = await call<{ config: Cfg }>("/config", { method: "PUT", body: patch });
      setCfg(r.config);
      setMsg({ ok: true, text: "Salvo." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const pulseCost = typical(pulses.filter((p) => p.model === cfg.pulse.model).map((p) => p.costUSD));
  const last = s.pulse.last;
  const escalation = last?.escalation;
  const canEscalate = escalation && escalation.status === "aguardando" && (escalation.model === "sonnet" || escalation.model === "opus");
  const escCost = canEscalate ? typical(proposals.filter((p) => p.model === escalation!.model).map((p) => p.costUSD)) : null;
  return (
    <Section title="Plataforma" desc="O que o próprio monitor gasta: pulso de hora em hora, chat e escaladas. Equivalente API.">
      <Field>
        <FieldLabel>Pulso</FieldLabel>
        <ToggleGroup type="single" value={cfg.pulse.enabled ? "on" : "off"} onValueChange={(v: string) => v && save({ pulse: { ...cfg.pulse, enabled: v === "on" } })} variant="outline" size="sm" className="justify-start">
          <ToggleGroupItem value="on">Ligado</ToggleGroupItem>
          <ToggleGroupItem value="off">Desligado</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>Intervalo (min)</FieldLabel>
          <Input inputMode="numeric" defaultValue={cfg.pulse.everyMinutes} onBlur={(e) => save({ pulse: { ...cfg.pulse, everyMinutes: Math.max(5, Number(e.target.value) || 60) } })} />
        </Field>
        <Field>
          <FieldLabel>Teto diário (US$)</FieldLabel>
          <Input inputMode="decimal" defaultValue={cfg.platformDailyBudgetUSD} onBlur={(e) => save({ platformDailyBudgetUSD: Math.max(0, Number(e.target.value.replace(",", ".")) || 0) })} />
        </Field>
      </div>
      <Field>
        <FieldLabel>Modelo do pulso</FieldLabel>
        <ToggleGroup type="single" value={cfg.pulse.model} onValueChange={(v: string) => v && save({ pulse: { ...cfg.pulse, model: v } })} variant="outline" size="sm" className="justify-start">
          {["haiku", "sonnet"].map((m) => (
            <ToggleGroupItem key={m} value={m}>{m}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel>Escalada automática</FieldLabel>
        <ToggleGroup type="single" value={cfg.pulse.autoEscalate ? "on" : "off"} onValueChange={(v: string) => v && save({ pulse: { ...cfg.pulse, autoEscalate: v === "on" } })} variant="outline" size="sm" className="justify-start">
          <ToggleGroupItem value="off">Desligada</ToggleGroupItem>
          <ToggleGroupItem value="on">Ligada</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>Quando o pulso pede um modelo maior. Fable nunca roda sozinho.</FieldDescription>
      </Field>
      <p className="text-sm">
        Gasto hoje <span className="tabular font-medium">{usd(s.platform.todayCost)}</span> de {usd(s.platform.budget)} · {s.platform.calls} {s.platform.calls === 1 ? "chamada" : "chamadas"}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          className="w-full md:w-auto"
          disabled={running}
          onClick={async () => {
            setMsg(null);
            try {
              await call("/pulse", { body: {} });
            } catch (e) {
              setMsg({ ok: false, text: (e as Error).message });
            }
          }}
        >
          {running ? <Spinner /> : <Heartbeat />} {running ? "Pulsando…" : `Pulsar agora ${pulseCost != null ? `~${usd(pulseCost)}` : "(custo aparece após o primeiro)"}`}
        </Button>
        <span className="text-xs text-muted-foreground">{s.pulse.lastAt ? `último pulso ${ago(s.pulse.lastAt)}` : "nenhum pulso ainda"}{s.pulse.nextAt ? ` · próximo em ${Math.max(1, Math.round((Date.parse(s.pulse.nextAt) - Date.now()) / 60_000))} min` : ""}</span>
      </div>
      {last && (last.findings.length > 0 || last.error) && (
        <div className="rounded-md border p-3 text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Último pulso ({last.model}, {ago(last.at)}{last.costUSD != null ? `, custou ${usd(last.costUSD, 3)}` : ""})</div>
          {last.error ? <p className="text-x-error">{last.error}</p> : <ul className="list-disc space-y-1 pl-4">{last.findings.map((f) => <li key={f}>{noPaths(f)}</li>)}</ul>}
          {canEscalate && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={escBusy}
                onClick={async () => {
                  setEscBusy(true);
                  setEsc(null);
                  try {
                    const r = await call<{ status: string; note?: string }>("/pulse/escalate", { body: {} });
                    setEsc(r.status + (r.note ? ` — ${r.note}` : ""));
                  } catch (e) {
                    setEsc((e as Error).message);
                  } finally {
                    setEscBusy(false);
                  }
                }}
              >
                <ArrowFatLinesUp /> {escBusy ? "Analisando…" : `Escalar para ${escalation!.model} ${escCost != null ? `~${usd(escCost)}` : "(custo aparece após a primeira)"}`}
              </Button>
              {esc && <span className="text-xs text-muted-foreground">{esc}</span>}
            </div>
          )}
          {escalation?.model === "fable" && <p className="mt-2 text-x-highlight">O pulso pediu Fable: isso só roda com a sua liberação.</p>}
        </div>
      )}
      {msg && <span className={`text-sm ${msg.ok ? "text-x-success" : "text-x-error"}`}>{msg.text}</span>}
    </Section>
  );
}

function FableManual() {
  const s = useSnapshot();
  const [val, setVal] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!s) return null;
  const fw = s.verdict.windows.find((w) => w.id === "fable-7d");
  const manual = fw?.source === "manual" ? fw : null;
  const save = async (pct: number | null) => {
    setMsg(null);
    try {
      await call("/fable-manual", { body: { pct } });
      setVal("");
      setMsg({ ok: true, text: pct == null ? "Registro apagado." : "Registrado. A barra do Fable ganhou o %." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <Section title="Fable no /usage" desc="A linha de status não traz o limite por modelo. Se quiser a terceira barra com %, copie aqui o que o /usage do Claude Code mostra para o Fable. Vale até a renovação da semana.">
      {manual && (
        <p className="text-sm">
          <span className="tabular font-medium">{Math.round(manual.usedPct ?? 0)} %</span> informado por você {manual.manualAt ? ago(manual.manualAt) : ""} · vale até {manual.resetHuman}
        </p>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(val.replace(",", "."));
          if (val.trim() && Number.isFinite(n)) void save(n);
        }}
      >
        <Field className="w-32">
          <FieldLabel htmlFor="fable-pct">Fable agora (%)</FieldLabel>
          <Input id="fable-pct" inputMode="decimal" value={val} placeholder="ex.: 20" onChange={(e) => setVal(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!val.trim()}>Registrar</Button>
        {manual && (
          <Button type="button" variant="ghost" onClick={() => save(null)}>
            Apagar registro
          </Button>
        )}
      </form>
      {msg && <span className={`text-sm ${msg.ok ? "text-x-success" : "text-x-error"}`}>{msg.text}</span>}
    </Section>
  );
}

function Versions() {
  const layout = useLayout();
  if (!layout) return null;
  return (
    <Section title="Versões dos widgets" desc="As peças vivas do painel. Cada troca passa por conferência de tipos e render de teste antes de entrar no ar; aqui você desfaz ou põe no ar uma versão guardada.">
      <ul className="flex flex-col divide-y">
        {layout.slots.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">versão {s.version} no ar · {layout.versions[s.widget]?.length ?? 1} guardadas · em {PAGE_NAME[s.page]}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHash(`versoes/${s.widget}`)}>
              <StackSimple /> Versões
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
const PAGE_NAME = { agora: "Agora", semana: "Semana", reserva: "Reserva", avisos: "Avisos" } as const;

export function AjustesPage({ extra }: { extra?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] @[110rem]:grid-cols-[minmax(0,40rem)_minmax(0,40rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <ClaudeDefaults />
        <StatusLineSetup />
        <FableManual />
        {extra}
      </div>
      <div className="flex flex-col gap-4">
        <Platform />
        <Section title="Notificações">
          <NotifySetting />
        </Section>
        <Section title="Tema">
          <ThemeToggle className="self-start" />
        </Section>
      </div>
      <div className="flex flex-col gap-4 @5xl:col-start-2 @[110rem]:col-start-3 @[110rem]:row-start-1">
        <Versions />
      </div>
    </div>
  );
}

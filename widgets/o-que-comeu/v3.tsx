// O que comeu v2: "Hoje" e "Ciclo" (7 dias desde a renovação) num card só, absorvendo as causas do
// "Por quê hoje". Card estreito = uma coluna com alternância; largo (container query) = duas lado a lado.
import { useState, type ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { usd, useSnapshot, modelColor } from "../../src/sdk";
import { SonnetLever } from "../../src/levers";

const NAME: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" };
const pct = (n: number) => `${Math.round(n * 100)} %`;
const money = (n: number) => usd(n, n < 10 ? 2 : 0);
const lastSeg = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const familyOf = (id: string) => /opus/.test(id) ? "opus" : /sonnet/.test(id) ? "sonnet" : /haiku/.test(id) ? "haiku" : /fable|mythos/.test(id) ? "fable" : id;
const VISIBLE = 5;

type Line = { key: string; cost: number; share: number };

/** Soma linhas com a mesma chave; mesmo projeto em pastas diferentes vira uma linha só. */
function merge(rows: { key: string; cost: number }[], total: number, keyOf: (k: string) => string): Line[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyOf(r.key), (m.get(keyOf(r.key)) ?? 0) + r.cost);
  return [...m].map(([key, cost]) => ({ key, cost, share: total ? cost / total : 0 })).sort((a, b) => b.cost - a.cost);
}

function Row({ label, share, cost, color, action }: { label: string; share: number; cost: number; color: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate">{label}</span>
          <span className="tabular shrink-0 text-muted-foreground">
            <span className="font-medium text-foreground">{pct(share)}</span> · {money(cost)}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
        </div>
      </div>
      {action !== undefined && <div className="flex w-24 shrink-0 justify-end">{action}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

type Data = { models: Line[]; sub: Line; subOpus?: Line; projects: Line[] };

function Column({ data, lever }: { data: Data; lever: (row: (a: ReactNode) => ReactNode) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? data.projects : data.projects.slice(0, VISIBLE);
  const more = data.projects.length - VISIBLE;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Por modelo">
        {data.models.map((f) =>
          f.key === "opus" ? (
            <div key={f.key} className="flex flex-col gap-1">
              {lever((a) => <Row label="Opus" share={f.share} cost={f.cost} color={modelColor(f.key)} action={a ?? null} />)}
            </div>
          ) : (
            <Row key={f.key} label={NAME[f.key] ?? f.key} share={f.share} cost={f.cost} color={modelColor(f.key)} />
          ),
        )}
      </Section>
      <Section title="Subagentes">
        <Row label="Feito por subagentes" share={data.sub.share} cost={data.sub.cost} color="var(--x-faint)" />
        {data.subOpus && (
          <div className="flex flex-col gap-1">
            {lever((a) => <Row label="…em Opus" share={data.subOpus!.share} cost={data.subOpus!.cost} color={modelColor("opus")} action={a ?? null} />)}
          </div>
        )}
      </Section>
      <Section title="Por projeto">
        {shown.length === 0 && <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>}
        {shown.map((p) => (
          <Row key={p.key} label={p.key} share={p.share} cost={p.cost} color="var(--x-faint)" />
        ))}
        {more > 0 && (
          <button type="button" className="min-h-11 text-xs text-muted-foreground underline-offset-2 hover:underline md:min-h-9" onClick={() => setAll((v) => !v)}>
            {all ? "mostrar menos" : `mais ${more}`}
          </button>
        )}
      </Section>
    </div>
  );
}

export default function OQueComeu() {
  const s = useSnapshot();
  const [tab, setTab] = useState<"hoje" | "ciclo">("hoje");
  if (!s) return null;
  const sm = s.semana;
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  const untilHuman = w7?.resetHuman.split(",")[0] ?? "a renovação";
  const lever = (row: (a: ReactNode) => ReactNode) => <SonnetLever until={w7?.resetsAt ?? null} untilHuman={untilHuman} row={row} />;

  const tCost = s.today.cost;
  const today: Data | null = tCost < 0.01 ? null : {
    models: merge(s.byModel, tCost, familyOf),
    sub: { key: "sub", cost: s.sidechainToday.cost, share: s.sidechainToday.share },
    subOpus: s.sidechainToday.opusShare > 0.01 ? { key: "subopus", cost: s.sidechainToday.opusShare * tCost, share: s.sidechainToday.opusShare } : undefined,
    projects: merge(s.byProjectToday, tCost, lastSeg),
  };
  const cycle: Data | null = !sm.cost ? null : {
    models: sm.byFamily.map((f) => ({ key: f.key, cost: f.cost, share: f.share })),
    sub: { key: "sub", cost: sm.sideShare * sm.cost, share: sm.sideShare }, // US$ derivado: parcela × total do ciclo
    projects: merge(sm.byProject, sm.cost, lastSeg),
  };

  const empty = (t: string) => <p className="text-sm text-muted-foreground">{t}</p>;
  const col = (id: "hoje" | "ciclo", title: string, data: Data | null, none: string) => (
    <div className={`${tab === id ? "block" : "hidden"} min-w-0 @2xl:block`}>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {data ? <Column data={data} lever={lever} /> : empty(none)}
    </div>
  );

  return (
    <div className="@container flex flex-col gap-4">
      <ToggleGroup type="single" value={tab} onValueChange={(v: string) => v && setTab(v as "hoje" | "ciclo")} variant="outline" size="sm" className="justify-start @2xl:hidden">
        <ToggleGroupItem value="hoje" className="min-h-11 px-4 md:min-h-8">Hoje</ToggleGroupItem>
        <ToggleGroupItem value="ciclo" className="min-h-11 px-4 md:min-h-8">Ciclo</ToggleGroupItem>
      </ToggleGroup>
      <div className="grid gap-6 @2xl:grid-cols-2">
        {col("hoje", `Hoje · ${usd(tCost, tCost < 10 ? 2 : 0)}`, today, "Sem consumo hoje.")}
        {col("ciclo", `Ciclo · ${usd(sm.cost, 0)} · renova ${untilHuman}`, cycle, "Nada gasto neste ciclo ainda.")}
      </div>
    </div>
  );
}

// O que comeu: "Hoje" e "Ciclo" (7 dias desde a renovação) num card só — por modelo, subagentes e projeto.
// v4 — ocupa a célula e se revela pela altura dela:
//   corpo baixo → uma faixa por período (quem comeu, em proporção) e a legenda dos modelos;
//   tall-sm     → as listas. A de projetos mostra quantas linhas couberem na altura (mínimo 3);
//                 "mais N" abre o resto e o card rola. Card largo põe Hoje e Ciclo lado a lado.
import { useState, type ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { usd, useSnapshot, modelColor } from "../../src/sdk";
import { SonnetLever } from "../../src/levers";
import { useBox } from "../../src/ui";

const NAME: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" };
const pct = (n: number) => `${Math.round(n * 100)} %`;
const money = (n: number) => usd(n, n < 10 ? 2 : 0);
const lastSeg = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const familyOf = (id: string) => (/opus/.test(id) ? "opus" : /sonnet/.test(id) ? "sonnet" : /haiku/.test(id) ? "haiku" : /fable|mythos/.test(id) ? "fable" : id);
// layout arithmetic of one column (px): keep in step with the classes below
const ROW = 34;
const HEAD = 18;
const GAP = 12;
const MORE = 28;
const MIN_PROJECTS = 3;
const WIDE = 560;

type Line = { key: string; cost: number; share: number };
type Data = { total: number; models: Line[]; sub: Line; subOpus?: Line; projects: Line[] };
type Tab = "hoje" | "ciclo";

/** Soma linhas com a mesma chave; mesmo projeto em pastas diferentes vira uma linha só. Linha zerada sai. */
function merge(rows: { key: string; cost: number }[], total: number, keyOf: (k: string) => string): Line[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(keyOf(r.key), (m.get(keyOf(r.key)) ?? 0) + r.cost);
  return [...m]
    .map(([key, cost]) => ({ key, cost, share: total ? cost / total : 0 }))
    .filter((l) => l.cost >= 0.005)
    .sort((a, b) => b.cost - a.cost);
}

/** A row grows a little with spare height (34–56 px), so a tall cell has no dead strip at the bottom. */
function Row({ label, share, cost, color, action }: { label: string; share: number; cost: number; color: string; action?: ReactNode }) {
  return (
    <div className="flex max-h-14 min-h-[34px] flex-[1_1_34px] items-center gap-3">
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
      {action !== undefined && <div className="flex w-20 shrink-0 justify-end">{action}</div>}
    </div>
  );
}

const Head = ({ children, first }: { children: ReactNode; first?: boolean }) => <h3 className={`h-[18px] shrink-0 text-xs leading-4 text-muted-foreground ${first ? "" : "mt-3"}`}>{children}</h3>;

function Column({ title, data, none, lever }: { title?: string; data: Data | null; none: string; lever: (row: (a: ReactNode) => ReactNode) => ReactNode }) {
  const [all, setAll] = useState(false);
  const [ref, box] = useBox<HTMLDivElement>();
  if (!data)
    return (
      <div className="min-w-0 flex-1">
        {title && <h2 className="mb-2 text-sm font-medium">{title}</h2>}
        <p className="text-sm text-muted-foreground">{none}</p>
      </div>
    );
  const fixedRows = data.models.length + 1 + (data.subOpus ? 1 : 0);
  const room = box.h - (title ? 28 : 0) - 3 * HEAD - 2 * GAP - fixedRows * ROW;
  const total = data.projects.length;
  // every project fits → no "mais"; otherwise leave room for the button
  const fit = room >= total * ROW ? total : Math.max(MIN_PROJECTS, Math.floor((room - MORE) / ROW));
  const shown = all ? data.projects : data.projects.slice(0, fit);
  const more = total - fit;
  return (
    <div ref={ref} className="flex min-w-0 flex-1 flex-col">
      {title && <h2 className="mb-2 h-5 shrink-0 truncate text-sm font-medium">{title}</h2>}
      <Head first>Por modelo</Head>
      {data.models.map((f) =>
        f.key === "opus" ? (
          <div key={f.key} className="contents">
            {lever((a) => <Row label="Opus" share={f.share} cost={f.cost} color={modelColor(f.key)} action={a ?? null} />)}
          </div>
        ) : (
          <Row key={f.key} label={NAME[f.key] ?? f.key} share={f.share} cost={f.cost} color={modelColor(f.key)} />
        ),
      )}
      <Head>Subagentes</Head>
      <Row label="Feito por subagentes" share={data.sub.share} cost={data.sub.cost} color="var(--x-faint)" />
      {data.subOpus && <div className="contents">{lever((a) => <Row label="…em Opus" share={data.subOpus!.share} cost={data.subOpus!.cost} color={modelColor("opus")} action={a ?? null} />)}</div>}
      <Head>Por projeto</Head>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>}
      {shown.map((p) => (
        <Row key={p.key} label={p.key} share={p.share} cost={p.cost} color="var(--x-faint)" />
      ))}
      {more > 0 && (
        <button type="button" className="h-7 shrink-0 self-start text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? "mostrar menos" : `mais ${more}`}
        </button>
      )}
    </div>
  );
}

/** Low body: one stacked strip per period — who ate, in proportion. */
function Strip({ label, data, none }: { label: string; data: Data | null; none: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-9 shrink-0 text-muted-foreground">{label}</span>
      {data ? (
        <span className="flex h-2.5 min-w-0 flex-1 gap-px overflow-hidden rounded-full bg-muted" role="img" aria-label={data.models.map((m) => `${NAME[m.key] ?? m.key} ${pct(m.share)}`).join(", ")}>
          {data.models.map((m) => (
            <span key={m.key} className="h-full" style={{ width: `${m.share * 100}%`, background: modelColor(m.key) }} title={`${NAME[m.key] ?? m.key} ${pct(m.share)} · ${money(m.cost)}`} />
          ))}
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{none}</span>
      )}
      {data && <span className="tabular w-16 shrink-0 text-right font-medium">{usd(data.total, 0)}</span>}
    </div>
  );
}

export default function OQueComeu() {
  const s = useSnapshot();
  const [tab, setTab] = useState<Tab>("hoje");
  const [ref, box] = useBox<HTMLDivElement>();
  if (!s) return null;
  const sm = s.semana;
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  const untilHuman = w7?.resetHuman.split(",")[0] ?? "a renovação";
  const lever = (row: (a: ReactNode) => ReactNode) => <SonnetLever until={w7?.resetsAt ?? null} untilHuman={untilHuman} row={row} />;

  const tCost = s.today.cost;
  const today: Data | null =
    tCost < 0.01
      ? null
      : {
          total: tCost,
          models: merge(s.byModel, tCost, familyOf),
          sub: { key: "sub", cost: s.sidechainToday.cost, share: s.sidechainToday.share },
          subOpus: s.sidechainToday.opusShare > 0.01 ? { key: "subopus", cost: s.sidechainToday.opusShare * tCost, share: s.sidechainToday.opusShare } : undefined,
          projects: merge(s.byProjectToday, tCost, lastSeg),
        };
  const cycle: Data | null = !sm.cost
    ? null
    : {
        total: sm.cost,
        models: sm.byFamily.filter((f) => f.cost >= 0.005).map((f) => ({ key: f.key, cost: f.cost, share: f.share })),
        sub: { key: "sub", cost: sm.sideShare * sm.cost, share: sm.sideShare }, // US$ derivado: parcela × total do ciclo
        projects: merge(sm.byProject, sm.cost, lastSeg),
      };
  const noToday = "Sem consumo hoje.";
  const noCycle = "Nada gasto neste ciclo ainda.";
  const wide = box.w >= WIDE;
  const families = [...new Set([...(today?.models ?? []), ...(cycle?.models ?? [])].map((m) => m.key))];

  return (
    <div ref={ref} className="h-full min-h-0">
      <div className="flex flex-col gap-1.5 tall-sm:hidden">
        <Strip label="Hoje" data={today} none={noToday} />
        <Strip label="Ciclo" data={cycle} none={noCycle} />
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-11 text-xs text-muted-foreground">
          {families.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: modelColor(k) }} />
              {NAME[k] ?? k}
            </span>
          ))}
        </div>
      </div>

      <div className="hidden h-full min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain tall-sm:flex" data-scroll="listas">
        {!wide && (
          <div className="flex shrink-0 items-center justify-between gap-3">
            <ToggleGroup type="single" value={tab} onValueChange={(v: string) => v && setTab(v as Tab)} variant="outline" size="sm" className="justify-start">
              <ToggleGroupItem value="hoje" className="min-h-11 px-4 md:min-h-8">
                Hoje
              </ToggleGroupItem>
              <ToggleGroupItem value="ciclo" className="min-h-11 px-4 md:min-h-8">
                Ciclo
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="min-w-0 truncate text-right text-sm">
              <span className="tabular font-semibold">{tab === "hoje" ? usd(tCost, tCost < 10 ? 2 : 0) : usd(sm.cost, 0)}</span>
              {tab === "ciclo" && <span className="text-muted-foreground"> · renova {untilHuman}</span>}
            </span>
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-8">
          {wide ? (
            <>
              <Column title={`Hoje · ${usd(tCost, tCost < 10 ? 2 : 0)}`} data={today} none={noToday} lever={lever} />
              <Column title={`Ciclo · ${usd(sm.cost, 0)} · renova ${untilHuman}`} data={cycle} none={noCycle} lever={lever} />
            </>
          ) : tab === "hoje" ? (
            <Column key="hoje" data={today} none={noToday} lever={lever} />
          ) : (
            <Column key="ciclo" data={cycle} none={noCycle} lever={lever} />
          )}
        </div>
      </div>
    </div>
  );
}

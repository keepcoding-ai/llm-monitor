// O que comeu a semana (G3): por modelo, subagentes e projeto — com a alavanca onde há uma.
import type { ReactNode } from "react";
import { usd, useSnapshot, modelColor } from "../../src/sdk";
import { SonnetLever } from "../../src/levers";

const NAME: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" };
const pct = (n: number) => `${Math.round(n * 100)} %`;
const lastSeg = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Mesmo nome de projeto em pastas diferentes vira uma linha só (a tela nunca mostra caminho). */
function merged(rows: { key: string; share: number }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(lastSeg(r.key), (m.get(lastSeg(r.key)) ?? 0) + r.share);
  return [...m].map(([key, share]) => ({ key, share })).sort((a, b) => b.share - a.share);
}

function Row({ label, share, color, action }: { label: string; share: number; color: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="truncate">{label}</span>
          <span className="tabular shrink-0 font-medium">{pct(share)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
        </div>
      </div>
      {action !== undefined && <div className="flex w-24 shrink-0 justify-end">{action}</div>}
    </div>
  );
}

export default function OQueComeu() {
  const s = useSnapshot();
  if (!s) return null;
  const sm = s.semana;
  if (!sm.cost) return <p className="text-sm text-muted-foreground">Nada gasto nesta semana ainda.</p>;
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  const untilHuman = w7?.resetHuman.split(",")[0] ?? "a renovação";
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-xs text-muted-foreground">Por modelo · {usd(sm.cost, 0)} desde a renovação</h3>
        {sm.byFamily.map((f) =>
          f.key === "opus" ? (
            <div key={f.key} className="flex flex-col gap-1">
              <SonnetLever until={w7?.resetsAt ?? null} untilHuman={untilHuman} row={(a) => <Row label={NAME[f.key]} share={f.share} color={modelColor(f.key)} action={a ?? null} />} />
            </div>
          ) : (
            <Row key={f.key} label={NAME[f.key] ?? f.key} share={f.share} color={modelColor(f.key)} />
          ),
        )}
      </section>
      <section>
        <h3 className="mb-1 text-xs text-muted-foreground">Subagentes</h3>
        <Row label="Feito por subagentes" share={sm.sideShare} color="var(--x-faint)" />
      </section>
      <section>
        <h3 className="mb-1 text-xs text-muted-foreground">Por projeto</h3>
        {merged(sm.byProject).map((p) => (
          <Row key={p.key} label={p.key} share={p.share} color="var(--x-faint)" />
        ))}
      </section>
    </div>
  );
}

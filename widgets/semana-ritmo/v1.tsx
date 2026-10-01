// Semana como plano (G5): a linha do % oficial desde a renovação, o ritmo que
// chega exatamente na renovação e a projeção do veredito (mesma função).
import { motion, useReducedMotion } from "framer-motion";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { usd, useSnapshot } from "../../src/sdk";

const W = 600;
const Hh = 220;
const PAD = { l: 34, r: 12, t: 12, b: 24 };
const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function SemanaRitmo() {
  const s = useSnapshot();
  const reduce = useReducedMotion();
  if (!s) return null;
  const sm = s.semana;
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  if (!sm.weekStart || !sm.resetsAt || sm.usedPct == null || !w7)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Sem a leitura da semana</EmptyTitle>
          <EmptyDescription>A linha aparece quando a linha de status do Claude Code estiver ativa — está em Ajustes.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const t0 = Date.parse(sm.weekStart);
  const t1 = Date.parse(sm.resetsAt);
  const now = Date.parse(s.at);
  const x = (t: number) => PAD.l + ((Math.min(t1, t) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - Math.min(100, p) / 100) * (Hh - PAD.t - PAD.b);
  const pts = [...sm.points, { t: s.at, pct: sm.usedPct }];
  const actual = pts.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.t)).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" ");
  // projeção = a do veredito: até 100 % em hitsAt (esgota) ou até projAtReset na renovação
  const projEnd = w7.exhausts && w7.hitsAt ? { t: Date.parse(w7.hitsAt), p: 100 } : { t: t1, p: w7.projAtReset ?? sm.usedPct };
  const proj = `M${x(now)},${y(sm.usedPct)} L${x(projEnd.t)},${y(projEnd.p)}`;
  const projColor = w7.exhausts ? "var(--x-alert)" : "var(--x-success)";
  const dayIdx = Math.min(7, Math.floor((now - t0) / 86_400_000) + 1);
  const ticks = Array.from({ length: 8 }, (_, i) => t0 + i * 86_400_000);
  const resetDay = w7.resetHuman.split(",")[0];
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className="tabular text-2xl font-semibold tracking-tight">{Math.round(sm.usedPct)} %</span> <span className="text-muted-foreground">da semana · dia {dayIdx} de 7</span>
        </p>
        <p className="text-sm text-muted-foreground">renova {w7.resetHuman}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="h-auto w-full" role="img" aria-label={`Semana em ${Math.round(sm.usedPct)} %. ${w7.exhausts ? `Nesse ritmo esgota ${w7.hitsHuman}` : `Nesse ritmo chega à renovação com ${Math.round(w7.projAtReset ?? sm.usedPct)} %`}.`} data-proj-end={new Date(projEnd.t).toISOString()} data-proj-pct={projEnd.p}>
        {[0, 50, 100].map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(p) + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">{p}%</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={Hh - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">{DAYS[new Date(t).getDay()]}</text>
        ))}
        <line x1={x(t0)} y1={y(0)} x2={x(t1)} y2={y(100)} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="2 4" />
        <motion.path d={proj} fill="none" stroke={projColor} strokeWidth={2} strokeDasharray="6 5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.3 }} />
        <motion.path d={actual} fill="none" stroke="var(--foreground)" strokeWidth={2.5} strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
        <circle cx={x(now)} cy={y(sm.usedPct)} r={4} fill="var(--foreground)" />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-foreground" />% oficial</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: projColor }} />nesse ritmo{w7.exhausts ? ` (esgota ${w7.hitsHuman})` : ""}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dotted border-muted-foreground" />ritmo que chega na renovação</span>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Para chegar {resetDay ? `à renovação de ${resetDay}` : "à renovação"}</div>
          <div className="tabular font-medium">até {sm.needPerDay != null ? fmt(sm.needPerDay) : "—"} %/dia</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Hoje</div>
          <div className={`tabular font-medium ${sm.needPerDay != null && sm.todayPct != null && sm.todayPct > sm.needPerDay ? "text-x-alert" : ""}`}>{sm.todayPct != null ? `${fmt(sm.todayPct)} %` : "sem leitura de ontem"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Esta semana</div>
          <div className="tabular font-medium">{usd(sm.cost, 0)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Semana passada</div>
          <div className="tabular font-medium">{sm.lastWeekCost != null ? usd(sm.lastWeekCost, 0) : "sem histórico"}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Custos em equivalente API.</p>
    </div>
  );
}

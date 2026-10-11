// Semana como plano (G5): o % oficial desde a renovação, o ritmo que chega exatamente na
// renovação e a projeção do veredito (mesma função).
// v2 — ocupa a célula e se revela pela altura dela:
//   corpo baixo  → a resposta (% da semana, onde esse ritmo vai dar) e uma régua com o ritmo certo;
//   tall-sm      → a régua vira o gráfico, que estica para preencher;
//   tall-md      → legenda; com largura (@xl) os números ficam ao lado do gráfico;
//   tall-xl      → em card estreito os números entram embaixo.
import { motion, useReducedMotion } from "framer-motion";
import { usd, useSnapshot } from "../../src/sdk";

const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DAY = 86_400_000;

export default function SemanaRitmo() {
  const s = useSnapshot();
  const reduce = useReducedMotion();
  if (!s) return null;
  const sm = s.semana;
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  if (!sm.weekStart || !sm.resetsAt || sm.usedPct == null || !w7)
    return (
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Sem a leitura da semana.</span> A linha aparece quando a linha de status do Claude Code estiver ativa — está em Ajustes.
      </p>
    );
  const t0 = Date.parse(sm.weekStart);
  const t1 = Date.parse(sm.resetsAt);
  const now = Date.parse(s.at);
  const used = sm.usedPct;
  // chart space: x and y in 0–100, stretched to whatever box the cell gives
  const x = (t: number) => ((Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0)) * 100;
  const y = (p: number) => 100 - Math.max(0, Math.min(100, p));
  const pts = [...sm.points, { t: s.at, pct: used }];
  const actual = pts.map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.t)).toFixed(2)},${y(p.pct).toFixed(2)}`).join(" ");
  // projeção = a do veredito: até 100 % em hitsAt (esgota) ou até projAtReset na renovação
  const projEnd = w7.exhausts && w7.hitsAt ? { t: Date.parse(w7.hitsAt), p: 100 } : { t: t1, p: w7.projAtReset ?? used };
  const projColor = w7.exhausts ? "var(--x-alert)" : "var(--x-success)";
  const dayIdx = Math.min(7, Math.floor((now - t0) / DAY) + 1);
  const ticks = Array.from({ length: 8 }, (_, i) => t0 + i * DAY);
  const resetDay = w7.resetHuman.split(",")[0];
  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const ideal = x(now); // where the week would be at the pace that lands exactly on the renewal
  const outcome = w7.exhausts ? `nesse ritmo esgota ${w7.hitsHuman}` : `nesse ritmo chega à renovação com ${Math.round(w7.projAtReset ?? used)} %`;
  const band = used >= 90 ? "bg-x-error" : used >= 70 ? "bg-x-alert" : "bg-x-success";
  const stats = [
    { label: `Para chegar ${resetDay ? `a ${resetDay}` : "à renovação"}`, value: sm.needPerDay != null ? `até ${fmt(sm.needPerDay)} %/dia` : "—", alert: false },
    { label: "Hoje", value: sm.todayPct != null ? `${fmt(sm.todayPct)} %` : "sem leitura de ontem", alert: sm.needPerDay != null && sm.todayPct != null && sm.todayPct > sm.needPerDay },
    { label: "Esta semana", value: usd(sm.cost, 0), alert: false },
    { label: "Semana passada", value: sm.lastWeekCost != null ? usd(sm.lastWeekCost, 0) : "sem histórico", alert: false },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 tall-sm:gap-2 tall-md:gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="text-sm">
          <span className="tabular text-2xl font-semibold tracking-tight">{Math.round(used)} %</span>{" "}
          <span className="text-muted-foreground">
            da semana · dia {dayIdx} de 7<span className="hidden tall-sm:inline @xl:inline"> · renova {w7.resetHuman}</span>
          </span>
        </p>
        <p className={`text-sm font-medium ${w7.exhausts ? "text-x-alert" : "text-x-success"}`}>{outcome}</p>
      </div>

      {/* low body: a ruler — how much is used, and the tick where the right pace would be now */}
      <div className="tall-sm:hidden">
        <div className="relative h-2 rounded-full bg-muted" role="img" aria-label={`Semana em ${Math.round(used)} %. No ritmo que chega à renovação estaria em ${Math.round(ideal)} %.`}>
          <div className={`h-full rounded-full ${band}`} style={{ width: `${Math.min(100, used)}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${ideal}%` }} aria-hidden />
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          <span className="mr-1 inline-block h-2.5 w-0.5 translate-y-px rounded-full bg-foreground" aria-hidden />
          ritmo certo estaria em {Math.round(ideal)} %<span className="@xl:hidden"> · renova {w7.resetHuman}</span>
        </p>
      </div>

      <div className="hidden min-h-0 flex-1 gap-6 tall-sm:flex">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* chart: stretches to the box; labels are HTML so they never distort */}
          <div className="relative min-h-16 flex-1">
            <div className="absolute inset-y-0 left-0 w-8 text-[11px] leading-none text-muted-foreground" style={{ bottom: "1.25rem" }} aria-hidden>
              {[100, 50, 0].map((p) => (
                <span key={p} className="absolute right-1.5 -translate-y-1/2" style={{ top: `${y(p)}%` }}>
                  {p}%
                </span>
              ))}
            </div>
            <div className="absolute top-0 right-3 left-8" style={{ bottom: "1.25rem" }}>
              <motion.svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full overflow-visible"
                role="img"
                aria-label={`Semana em ${Math.round(used)} %. ${w7.exhausts ? `Nesse ritmo esgota ${w7.hitsHuman}` : `Nesse ritmo chega à renovação com ${Math.round(w7.projAtReset ?? used)} %`}.`}
                data-proj-end={new Date(projEnd.t).toISOString()}
                data-proj-pct={projEnd.p}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              >
                {[0, 50, 100].map((p) => (
                  <line key={p} x1={0} x2={100} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
                <line x1={0} y1={100} x2={100} y2={0} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
                <line x1={x(now)} y1={y(used)} x2={x(projEnd.t)} y2={y(projEnd.p)} stroke={projColor} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
                <path d={actual} fill="none" stroke="var(--foreground)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </motion.svg>
              <span className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card" style={{ left: `${x(now)}%`, top: `${y(used)}%` }} aria-hidden />
              <div className="absolute inset-x-0 top-full h-5 text-[11px] text-muted-foreground" aria-hidden>
                {ticks.map((t, i) => (
                  <span key={t} className={`absolute top-1.5 -translate-x-1/2 leading-none ${i % 2 ? "hidden @sm:inline" : ""}`} style={{ left: `${x(t)}%` }}>
                    {DAYS[new Date(t).getDay()]}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tall-md:flex">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-foreground" />% oficial
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: projColor }} />
              nesse ritmo
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dotted border-muted-foreground" />
              ritmo que chega na renovação
            </span>
          </div>
          {/* narrow card: the numbers go below, once there is height for them */}
          <dl className="hidden grid-cols-2 gap-x-3 gap-y-2 border-t pt-2 text-sm tall-xl:grid @xl:hidden!">
            {stats.map((st) => (
              <div key={st.label} className="min-w-0">
                <dt className="truncate text-xs text-muted-foreground">{st.label}</dt>
                <dd className={`tabular font-medium ${st.alert ? "text-x-alert" : ""}`}>{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {/* wide card: the numbers sit beside the chart and share its height */}
        <div className="hidden w-44 shrink-0 flex-col justify-between gap-1 border-l pl-6 text-sm tall-md:@xl:flex">
          <dl className="contents">
          {stats.map((st) => (
            <div key={st.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground">{st.label}</dt>
              <dd className={`tabular font-medium ${st.alert ? "text-x-alert" : ""}`}>{st.value}</dd>
            </div>
          ))}
          </dl>
          <p className="hidden text-xs text-muted-foreground tall-lg:block">Custos em equivalente API.</p>
        </div>
      </div>
    </div>
  );
}

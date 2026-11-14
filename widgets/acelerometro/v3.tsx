// Acelerômetro v3: curva do gasto acumulado (12 h, fatias de 5 min) contra a reta do que o limite
// da semana aguenta. A inclinação é o ritmo; trecho vermelho = mais inclinado que o orçamento.
// Embaixo, uma linha por sessão: subida contínua e sem pausa indica processo preso.
import { usd, useSnapshot } from "../../src/sdk";

const FUTURO_H = 3;

type Slope = { start: string; stepMin: number; total: number[]; sessions: { session: string; project: string; viva: boolean; cost: number[] }[] };

function cumul(xs: number[]) {
  let a = 0;
  return xs.map((x) => (a += x));
}

export default function Acelerometro() {
  const s = useSnapshot();
  if (!s) return null;
  const sl = (s as unknown as { slope?: Slope }).slope;
  if (!sl || !sl.total?.length) {
    return <p className="text-sm text-muted-foreground">Aguardando o servidor enviar a série de 5 min.</p>;
  }

  const N = sl.total.length;
  const stepH = sl.stepMin / 60;
  const agora = new Date(s.at).getTime();
  const ritmo = sl.total.slice(-6).reduce((a, b) => a + b, 0) / (6 * stepH);

  const used = s.semana?.usedPct ?? null;
  const reset = s.semana?.resetsAt ? new Date(s.semana.resetsAt).getTime() : null;
  let cabe: number | null = null;
  let sobra: number | null = null;
  if (used != null && used > 0 && reset && s.semana.cost > 0) {
    sobra = Math.max(0, ((100 - used) * s.semana.cost) / used);
    cabe = sobra / Math.max(1, (reset - agora) / 3_600_000);
  }
  const normal = s.heatmap?.[new Date(s.at).getDay()]?.[new Date(s.at).getHours()] ?? 0;
  const ref = cabe ?? normal;

  const movel = sl.total.map((_, i) => sl.total.slice(Math.max(0, i - 5), i + 1).reduce((a, b) => a + b, 0) / (6 * stepH));
  const acima = ref > 0 && ritmo > ref;
  let minAcima = 0;
  for (let i = N - 1; i >= 0 && ref > 0 && movel[i] > ref; i--) minAcima += sl.stepMin;

  const esgotaH = sobra != null && ritmo > 0 ? sobra / ritmo : null;
  const esgotaAntes = esgotaH != null && reset != null && agora + esgotaH * 3_600_000 < reset;
  const tom = acima && (minAcima >= 15 || esgotaAntes) ? "error" : acima ? "alert" : "success";
  const cor = `var(--x-${tom})`;

  const cum = cumul(sl.total);
  const fim = cum[N - 1];
  const totalH = N * stepH + FUTURO_H;
  const yMax = Math.max(1, fim + Math.max(ritmo, ref) * FUTURO_H) * 1.08;
  const X = (h: number) => (h / totalH) * 100;
  const Y = (v: number) => 100 - (v / yMax) * 100;
  const xAgora = X(N * stepH);
  const segs = cum.map((v, i) => ({
    d: `M ${X(i * stepH)} ${Y(i ? cum[i - 1] : 0)} L ${X((i + 1) * stepH)} ${Y(v)}`,
    hot: ref > 0 && movel[i] > ref,
  }));
  const hora = (h: number) => `${new Date(new Date(sl.start).getTime() + h * 3_600_000).getHours()}h`;
  const marcas = [0, 3, 6, 9, 12, 15].filter((h) => h <= totalH);

  const sess = sl.sessions
    .map((x) => {
      let cont = 0;
      for (let i = N - 1; i >= 0 && x.cost[i] > 0; i--) cont += sl.stepMin;
      const soma = x.cost.reduce((a, b) => a + b, 0);
      const r30 = x.cost.slice(-6).reduce((a, b) => a + b, 0) / (6 * stepH);
      return { ...x, cont, soma, r30, c: cumul(x.cost) };
    })
    .filter((x) => x.soma > 0.01);
  const sMax = Math.max(0.01, ...sess.map((x) => x.soma));

  const frase =
    tom === "error"
      ? `Acima do que a semana aguenta${minAcima ? ` há ${minAcima} min` : ""}`
      : tom === "alert"
        ? "Acima do orçamento agora"
        : "Dentro do que a semana aguenta";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3">
        <div>
          <span className="text-2xl font-semibold tabular-nums" style={{ color: cor }}>{usd(ritmo)}/h</span>
          <span className="ml-2 text-sm font-medium">{frase}</span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {cabe != null ? `Cabe ${usd(cabe)}/h até renovar` : `Normal ${usd(normal)}/h`}
          {esgotaAntes && esgotaH != null ? ` · nesse ritmo esgota em ${esgotaH < 1 ? `${Math.round(esgotaH * 60)} min` : `${esgotaH.toFixed(1)} h`}` : ""}
        </div>
      </div>

      <div className="relative hidden min-h-[60px] flex-1 tall-sm:block">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <rect x={xAgora} y="0" width={100 - xAgora} height="100" fill="var(--muted)" opacity="0.5" />
          {segs.map((g, i) => (
            <path key={i} d={g.d} fill="none" stroke={g.hot ? "var(--x-error)" : "var(--x-sky)"} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          ))}
          {ref > 0 && (
            <path d={`M ${xAgora} ${Y(fim)} L 100 ${Y(fim + ref * FUTURO_H)}`} fill="none" stroke="var(--x-success)" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          )}
          <path d={`M ${xAgora} ${Y(fim)} L 100 ${Y(fim + ritmo * FUTURO_H)}`} fill="none" stroke={cor} strokeWidth="1.5" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          <line x1={xAgora} x2={xAgora} y1="0" y2="100" stroke="currentColor" strokeOpacity="0.3" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="pointer-events-none absolute left-1 top-0 text-[10px] text-muted-foreground tabular-nums">{usd(fim, 0)} em 12 h</div>
        <div className="pointer-events-none absolute right-1 top-0 flex flex-col items-end text-[10px] tabular-nums">
          <span style={{ color: cor }}>ritmo atual</span>
          {ref > 0 && <span className="text-x-success">{cabe != null ? "o que cabe" : "normal"}</span>}
        </div>
        <div className="pointer-events-none absolute -bottom-4 left-0 right-0 h-3 text-[10px] text-muted-foreground">
          {marcas.map((h) => (
            <span key={h} className="absolute -translate-x-1/2" style={{ left: `${X(h)}%` }}>{h === 12 ? "agora" : hora(h)}</span>
          ))}
        </div>
      </div>
      <div className="hidden h-3 shrink-0 tall-sm:block" />

      <div className="hidden min-h-0 shrink flex-col gap-1 overflow-y-auto tall-lg:flex">
        <div className="text-xs font-medium text-muted-foreground">Sessões em 12 h · sem pausa e subindo = suspeita de processo preso</div>
        {sess.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma sessão do Claude Code gastou nas últimas 12 h.</p>
        ) : (
          sess.map((x) => {
            const preso = x.cont >= 30 && x.r30 >= Math.max(2, ref);
            return (
              <div key={x.session} className="flex items-center gap-2 text-xs">
                <div className="w-28 shrink-0 truncate @sm:w-40">
                  <span className={`mr-1 inline-block size-1.5 rounded-full ${x.viva ? "bg-x-success" : "bg-muted-foreground/40"}`} />
                  {x.project}
                </div>
                <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 min-w-0 flex-1">
                  <path
                    d={x.c.map((v, i) => `${i ? "L" : "M"} ${(i / (N - 1)) * 100} ${20 - (v / sMax) * 18}`).join(" ")}
                    fill="none"
                    stroke={preso ? "var(--x-error)" : "var(--x-sky)"}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className={`w-24 shrink-0 text-right tabular-nums ${preso ? "font-semibold text-x-error" : ""}`}>
                  {usd(x.soma)}
                  {x.cont >= 15 ? <div className="text-[10px]">sem pausa {x.cont} min</div> : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

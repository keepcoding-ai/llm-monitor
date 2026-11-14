// Acelerômetro v4: o ângulo da curva de gasto acumulado agora, de 0° (deitada, nada gasto) a 90° (em pé).
// Tangente = reta de mínimos quadrados sobre os últimos k pontos de 5 min da curva.
// Escala: 45° = o ritmo médio das últimas 12 h (o quadrado 12 h × gasto de 12 h).
// Três ponteiros: curto (15 min), médio (30 min, o principal) e longo (1 h, fantasma).
import { usd, useSnapshot } from "../../src/sdk";

type Slope = { start: string; stepMin: number; total: number[] };

const JANELAS = [
  { k: 3, nome: "15 min" },
  { k: 6, nome: "30 min" },
  { k: 12, nome: "1 h" },
] as const;

/** inclinação em US$/h da reta de mínimos quadrados sobre os últimos k pontos acumulados */
function tangente(cum: number[], k: number, stepH: number) {
  const ys = cum.slice(-(k + 1)); // k fatias = k+1 pontos da curva
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return Math.max(0, num / den / stepH);
}

const P = { x: 8, y: 92, r: 82 }; // pivô no canto inferior esquerdo, quarto de círculo
const pt = (deg: number, r = P.r) => {
  const a = (deg * Math.PI) / 180;
  return { x: P.x + r * Math.cos(a), y: P.y - r * Math.sin(a) };
};
const arco = (d0: number, d1: number) => {
  const a = pt(d0), b = pt(d1);
  return `M ${a.x} ${a.y} A ${P.r} ${P.r} 0 0 0 ${b.x} ${b.y}`;
};

export default function Acelerometro() {
  const s = useSnapshot();
  if (!s) return null;
  const sl = (s as unknown as { slope?: Slope }).slope;
  if (!sl || !sl.total?.length) {
    return <p className="text-sm text-muted-foreground">Aguardando a série de 5 min do servidor.</p>;
  }

  const stepH = sl.stepMin / 60;
  let acc = 0;
  const cum = [0, ...sl.total.map((x) => (acc += x))];
  const media = acc / (sl.total.length * stepH); // US$/h médio das 12 h
  const ang = (r: number) => (media > 0 ? (Math.atan(r / media) * 180) / Math.PI : r > 0 ? 90 : 0);

  const [curto, medio, longo] = JANELAS.map((j) => {
    const ritmo = tangente(cum, j.k, stepH);
    return { ...j, ritmo, deg: ang(ritmo) };
  });

  const tom = medio.deg >= 70 ? "error" : medio.deg >= 50 ? "alert" : "success";
  const cor = `var(--x-${tom})`;
  const dif = curto.deg - longo.deg;
  const tendencia = dif > 5 ? { seta: "↑", txt: "acelerando" } : dif < -5 ? { seta: "↓", txt: "desacelerando" } : { seta: "→", txt: "estável" };
  const nivel = medio.deg >= 70 ? "Muito alto" : medio.deg >= 50 ? "Alto" : medio.deg >= 25 ? "Normal" : medio.deg > 2 ? "Baixo" : "Parado";

  const ponteiro = (deg: number, w: number, stroke: string, op: number, r = P.r - 6) => {
    const e = pt(deg, r);
    return <line x1={P.x} y1={P.y} x2={e.x} y2={e.y} stroke={stroke} strokeWidth={w} strokeOpacity={op} strokeLinecap="round" />;
  };

  return (
    <div className="flex h-full min-h-0 items-center gap-3 @container">
      <svg viewBox="0 0 100 100" className="aspect-square h-full max-h-full max-w-[55%] shrink-0">
        <path d={arco(0, 50)} stroke="var(--x-success)" strokeWidth="7" fill="none" />
        <path d={arco(50, 70)} stroke="var(--x-alert)" strokeWidth="7" fill="none" />
        <path d={arco(70, 90)} stroke="var(--x-error)" strokeWidth="7" fill="none" />
        {(() => { const a = pt(45, P.r - 10), b = pt(45, P.r + 4); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />; })()}
        {ponteiro(longo.deg, 7, "currentColor", 0.18)}
        {ponteiro(curto.deg, 2, "var(--x-sky)", 0.9, P.r - 2)}
        {ponteiro(medio.deg, 5, "currentColor", 0.95)}
        <circle cx={P.x} cy={P.y} r="5" fill="currentColor" />
      </svg>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tabular-nums @xs:text-2xl tall-md:text-3xl" style={{ color: cor }}>{usd(medio.ritmo)}/h</span>
          <span className="text-lg font-semibold" style={{ color: cor }} aria-label={tendencia.txt}>{tendencia.seta}</span>
        </div>
        <div className="truncate text-sm font-medium">{nivel} · {tendencia.txt}</div>
        <div className="hidden truncate text-xs text-muted-foreground tall-sm:block">
          Média de 12 h: {usd(media)}/h (marca do meio)
        </div>
        <ul className="mt-1 hidden flex-col gap-0.5 text-xs tabular-nums tall-md:flex">
          <li className="flex justify-between gap-2"><span><span className="mr-1 inline-block h-0.5 w-3 bg-x-sky align-middle" />Curto · {curto.nome}</span><span>{usd(curto.ritmo)}/h</span></li>
          <li className="flex justify-between gap-2 font-medium"><span><span className="mr-1 inline-block h-1 w-3 bg-foreground align-middle" />Médio · {medio.nome}</span><span>{usd(medio.ritmo)}/h</span></li>
          <li className="flex justify-between gap-2 text-muted-foreground"><span><span className="mr-1 inline-block h-1.5 w-3 bg-foreground/20 align-middle" />Longo · {longo.nome}</span><span>{usd(longo.ritmo)}/h</span></li>
        </ul>
      </div>
    </div>
  );
}

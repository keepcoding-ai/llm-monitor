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

// meia-lua tradicional: valor 0° na ponta esquerda, 90° na direita, 45° no topo
const P = { x: 50, y: 52, r: 42 };
const vis = (v: number) => 180 - (Math.min(90, Math.max(0, v)) / 90) * 180; // valor → ângulo na tela
const pt = (v: number, r = P.r) => {
  const a = (vis(v) * Math.PI) / 180;
  return { x: P.x + r * Math.cos(a), y: P.y - r * Math.sin(a) };
};
const arco = (v0: number, v1: number) => {
  const a = pt(v0), b = pt(v1);
  return ;
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

  const ponteiro = (deg: number, w: number, stroke: string, op: number, r = P.r - 5) => {
    const e = pt(deg, r);
    return <line x1={P.x} y1={P.y} x2={e.x} y2={e.y} stroke={stroke} strokeWidth={w} strokeOpacity={op} strokeLinecap="round" />;
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-1 overflow-hidden">
      <svg viewBox="0 0 100 56" preserveAspectRatio="xMidYMax meet" className="min-h-0 w-full flex-1">
        <path d={arco(0, 50)} stroke="var(--x-success)" strokeWidth="6" fill="none" />
        <path d={arco(50, 70)} stroke="var(--x-alert)" strokeWidth="6" fill="none" />
        <path d={arco(70, 90)} stroke="var(--x-error)" strokeWidth="6" fill="none" />
        {(() => { const a = pt(45, P.r - 7), b = pt(45, P.r + 4); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />; })()}
        {ponteiro(longo.deg, 5, "currentColor", 0.18)}
        {ponteiro(curto.deg, 2, "var(--x-sky)", 0.9, P.r - 2)}
        {ponteiro(medio.deg, 3.5, "currentColor", 0.95)}
        <circle cx={P.x} cy={P.y} r="3.5" fill="currentColor" />
      </svg>

      <div className="flex w-full shrink-0 flex-col items-center gap-0.5 text-center">
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="text-lg font-semibold tabular-nums tall-md:text-2xl" style={{ color: cor }}>{usd(medio.ritmo)}/h</span>
          <span className="text-lg font-semibold" style={{ color: cor }} aria-label={tendencia.txt}>{tendencia.seta}</span>
        </div>
        <div className="hidden truncate text-sm font-medium tall-sm:block">{nivel} · {tendencia.txt}</div>
        <div className="hidden truncate text-xs text-muted-foreground tall-md:block">
          Média de 12 h: {usd(media)}/h (marca do meio)
        </div>
        <ul className="mt-1 hidden w-full max-w-64 flex-col gap-0.5 text-left text-xs tabular-nums tall-lg:flex">
          <li className="flex justify-between gap-2"><span><span className="mr-1 inline-block h-0.5 w-3 bg-x-sky align-middle" />Curto · {curto.nome}</span><span>{usd(curto.ritmo)}/h</span></li>
          <li className="flex justify-between gap-2 font-medium"><span><span className="mr-1 inline-block h-1 w-3 bg-foreground align-middle" />Médio · {medio.nome}</span><span>{usd(medio.ritmo)}/h</span></li>
          <li className="flex justify-between gap-2 text-muted-foreground"><span><span className="mr-1 inline-block h-1.5 w-3 bg-foreground/20 align-middle" />Longo · {longo.nome}</span><span>{usd(longo.ritmo)}/h</span></li>
        </ul>
      </div>
    </div>
  );
}

// Picos v2: mapa de calor em grade (24 colunas iguais em qualquer largura),
// com a hora de pico destacada, e projetos que mais gastaram.
import { tokens, usd, useSnapshot } from "../../src/sdk";
import { RankList } from "../../src/ui";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function Picos() {
  const s = useSnapshot();
  if (!s) return null;
  const max = Math.max(1e-9, ...s.heatmap.flat());
  let peak = { d: 0, h: 0, v: 0 };
  s.heatmap.forEach((row, d) => row.forEach((v, h) => v > peak.v && (peak = { d, h, v })));
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto">
        <div className="grid min-w-[480px] gap-[3px]" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }} role="img" aria-label="Custo médio por hora e dia da semana">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] text-muted-foreground">
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
          {s.heatmap.map((row, d) => [
            <span key={`l${d}`} className="text-xs leading-4 text-muted-foreground">
              {DIAS[d]}
            </span>,
            ...row.map((v, h) => (
              <span
                key={`${d}-${h}`}
                title={`${DIAS[d]} ${h}h — ${usd(v)} em média`}
                className={`h-4 rounded-[3px] ${peak.d === d && peak.h === h ? "ring-2 ring-x-highlight" : ""}`}
                style={{ background: v ? `color-mix(in oklch, var(--x-orange) ${Math.round(12 + (v / max) * 88)}%, transparent)` : "var(--muted)" }}
              />
            )),
          ])}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Pico: {DIAS[peak.d]} às {peak.h}h, média de {usd(peak.v)} por semana (últimas 4 semanas).
      </p>
      <div>
        <div className="mb-2 text-xs text-muted-foreground">Projetos que mais gastaram (7 dias)</div>
        <RankList color={() => "var(--x-blue)"} rows={s.byProject.slice(0, 5).map((p) => ({ key: p.key, label: p.key, value: p.cost, display: usd(p.cost), sub: `${tokens(p.total)} tokens` }))} />
      </div>
    </div>
  );
}

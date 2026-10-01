// Picos: mapa de calor hora × dia da semana (média de 4 semanas) e projetos.
import { tokens, usd, useSnapshot } from "../../src/sdk";
import { RankList } from "../../src/ui";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function Picos() {
  const s = useSnapshot();
  if (!s) return null;
  const max = Math.max(1e-9, ...s.heatmap.flat());
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-[2px]" aria-label="Custo médio por hora e dia da semana">
          <thead>
            <tr>
              <th />
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} className="text-[10px] font-normal text-muted-foreground">
                  {h % 3 === 0 ? h : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.heatmap.map((row, d) => (
              <tr key={d}>
                <th className="pr-1 text-left text-xs font-normal text-muted-foreground">{DIAS[d]}</th>
                {row.map((v, h) => (
                  <td
                    key={h}
                    title={`${DIAS[d]} ${h}h — ${usd(v)} em média`}
                    className="h-4 rounded-[3px]"
                    style={{ background: v ? `color-mix(in oklch, var(--x-orange) ${Math.round(15 + (v / max) * 85)}%, transparent)` : "var(--muted)" }}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-2 text-xs text-muted-foreground">Projetos que mais gastaram (7 dias)</div>
        <RankList color={() => "var(--x-blue)"} rows={s.byProject.slice(0, 5).map((p) => ({ key: p.key, label: p.key, value: p.cost, display: usd(p.cost), sub: `${tokens(p.total)} tokens` }))} />
      </div>
    </div>
  );
}

// Acelerômetro: ritmo de gasto agora (US$/h, últimos 30 min) contra o normal desta hora,
// tendência hora a hora e sessões suspeitas de processo preso.
import { modelName, usd, useSnapshot } from "../../src/sdk";

const LIMITE_SESSAO_H = 10; // US$/h por sessão que acende suspeita

export default function Acelerometro() {
  const s = useSnapshot();
  if (!s) return null;
  const rows = s.bySessionRecent;
  if (!rows) return <p className="text-sm text-muted-foreground">Aguardando os dados por sessão.</p>;

  const agora = new Date(s.at);
  const ritmo = rows.reduce((a, r) => a + r.cost, 0) * 2; // 30 min → US$/h
  const normal = s.heatmap?.[agora.getDay()]?.[agora.getHours()] ?? 0;
  const razao = normal > 0.5 ? ritmo / normal : ritmo > 5 ? 3 : 0;
  const tom = razao >= 2 ? "error" : razao >= 1.3 ? "alert" : "success";
  const cor = `var(--x-${tom})`;
  const frase =
    tom === "error" ? "Disparado: bem acima do seu normal" : tom === "alert" ? "Acelerado: acima do normal" : "Ritmo normal";

  // ponteiro: 0 a 3× o normal
  const ang = -90 + Math.min(razao, 3) / 3 * 180;
  const rad = (ang * Math.PI) / 180;
  const px = 50 + 40 * Math.sin(rad), py = 50 - 40 * Math.cos(rad);
  const arco = (a0: number, a1: number) => {
    const p = (a: number) => { const r = (a * Math.PI) / 180; return `${50 + 40 * Math.sin(r)} ${50 - 40 * Math.cos(r)}`; };
    return `M ${p(a0)} A 40 40 0 0 1 ${p(a1)}`;
  };

  const ult = s.hourly.slice(-6);
  const max = Math.max(1, ...ult.map((h) => h.cost));
  const suspeitas = rows
    .map((r) => ({ ...r, porHora: r.cost * 2 }))
    .filter((r) => r.porHora >= LIMITE_SESSAO_H)
    .sort((a, b) => b.porHora - a.porHora);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 100 56" className="h-16 w-28 shrink-0 tall-md:h-24 tall-md:w-40">
          <path d={arco(-90, -30)} stroke="var(--x-success)" strokeWidth="8" fill="none" />
          <path d={arco(-30, 0)} stroke="var(--x-alert)" strokeWidth="8" fill="none" />
          <path d={arco(0, 90)} stroke="var(--x-error)" strokeWidth="8" fill="none" />
          <line x1="50" y1="50" x2={px} y2={py} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="50" cy="50" r="4" fill="currentColor" />
        </svg>
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums" style={{ color: cor }}>{usd(ritmo)}/h</div>
          <div className="text-sm font-medium">{frase}</div>
          <div className="text-xs text-muted-foreground">
            {normal > 0 ? `${razao.toFixed(1)}× o normal desta hora (${usd(normal)}/h)` : "Sem histórico para esta hora"}
          </div>
        </div>
      </div>

      <div className="hidden tall-sm:flex h-12 items-end gap-1">
        {ult.map((h) => (
          <div key={h.hour} className="flex flex-1 flex-col items-center gap-0.5">
            <div className="w-full rounded-sm bg-x-sky" style={{ height: `${(h.cost / max) * 36}px`, minHeight: 2 }} />
            <span className="text-[10px] text-muted-foreground tabular-nums">{new Date(h.hour).getHours()}h</span>
          </div>
        ))}
      </div>

      <div className="hidden min-h-0 flex-1 flex-col gap-1 tall-md:flex">
        <div className="text-xs font-medium text-muted-foreground">
          Suspeitas de processo preso (≥ {usd(LIMITE_SESSAO_H, 0)}/h nos últimos 30 min)
        </div>
        {suspeitas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma sessão gastando acima disso agora.</p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {suspeitas.map((r) => (
              <li key={r.session} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm"
                style={{ borderColor: "color-mix(in oklch, var(--x-error) 50%, transparent)" }}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.project} · {r.session.slice(0, 8)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.models.map((m) => modelName(m)).join(", ")} · {r.n} resp. em 30 min{r.viva ? " · aberta" : ""}
                  </div>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-x-error">{usd(r.porHora)}/h</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

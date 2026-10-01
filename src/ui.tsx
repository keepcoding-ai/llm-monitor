// Peças de visualização reusadas pelos widgets (uma vez, aqui — nunca copiadas
// dentro de cada versão de widget).
import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "alert" | "error" | "success" | "warning" }) {
  const color = tone ? { alert: "text-x-alert", error: "text-x-error", success: "text-x-success", warning: "text-x-warning" }[tone] : "";
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`tabular truncate text-2xl font-semibold tracking-tight tv:text-3xl ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Medidor com faixa por intenção: até 70% calmo, 70–90 alerta, 90+ erro. */
export function Meter({ value, label, sub }: { value: number; label: string; sub?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 90 ? "bg-x-error" : v >= 70 ? "bg-x-alert" : "bg-x-success";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="tabular text-sm font-medium">{v.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Barras empilhadas (série temporal). `segments` dá a cor de cada chave. */
export function StackedBars({
  data,
  keys,
  color,
  label,
  height = 120,
  format,
}: {
  data: { x: string; parts: Record<string, number> }[];
  keys: string[];
  color: (k: string) => string;
  label: (x: string) => string;
  height?: number;
  format: (n: number) => string;
}) {
  const max = Math.max(1e-9, ...data.map((d) => keys.reduce((s, k) => s + (d.parts[k] ?? 0), 0)));
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label="Gráfico de barras">
        {data.map((d) => {
          const total = keys.reduce((s, k) => s + (d.parts[k] ?? 0), 0);
          return (
            <div key={d.x} className="group relative flex h-full min-w-[4px] flex-1 flex-col justify-end" title={`${label(d.x)} — ${format(total)}`}>
              {keys.map((k) =>
                d.parts[k] ? (
                  <motion.div
                    key={k}
                    initial={{ height: 0 }}
                    animate={{ height: `${((d.parts[k] ?? 0) / max) * 100}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    style={{ background: color(k) }}
                    className="w-full first:rounded-t-sm"
                  />
                ) : null,
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Lista com barra proporcional (ranking). */
export function RankList({ rows, color }: { rows: { key: string; label: string; value: number; display: string; sub?: string }[]; color: (k: string) => string }) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="tabular shrink-0 font-medium">{r.display}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full" style={{ background: color(r.key) }} initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ duration: 0.35, ease: "easeOut" }} />
          </div>
          {r.sub && <div className="mt-0.5 text-xs text-muted-foreground">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

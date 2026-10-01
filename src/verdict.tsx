// Veredito no shell (plano §3, G1/G6/G9): frase + estado, três barras com reset
// humano e marcador da janela que decide, selo de proveniência. Fixo no shell —
// se quebra, quebra o build, nunca o dono.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge, Button, Skeleton } from "@atrium/core-ui";
import { CaretLeft, GearSix } from "@phosphor-icons/react";
import type { Verdict, VerdictState, VerdictWindow } from "../shared/snapshot";
import { ago, tokens, usd, useSnapshot } from "./sdk";

/** Cor por intenção do estado (borda do veredito e selo). */
const STATE_VIEW: Record<VerdictState, { label: string; bar: string; tone: "success" | "warning" | "error" | "muted" | "info"; text: string }> = {
  ok: { label: "Tranquilo", bar: "bg-x-success", tone: "success", text: "text-x-success" },
  attention: { label: "Atenção", bar: "bg-x-alert", tone: "warning", text: "text-x-alert" },
  critical: { label: "Crítico", bar: "bg-x-error", tone: "error", text: "text-x-error" },
  exhausted: { label: "Sem Claude", bar: "bg-x-critical", tone: "error", text: "text-x-critical" },
  missing: { label: "Sem leitura", bar: "bg-x-faint", tone: "muted", text: "text-muted-foreground" },
  stale: { label: "Leitura antiga", bar: "bg-x-faint", tone: "muted", text: "text-muted-foreground" },
};

export function useTick(ms = 5000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

const rate = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %/h`);

function WindowBar({ w, decisive, size }: { w: VerdictWindow; decisive: boolean; size: "md" | "lg" }) {
  const reduce = useReducedMotion();
  const v = w.usedPct == null ? null : Math.max(0, Math.min(100, w.usedPct));
  const color = v == null ? "" : v >= 90 ? "bg-x-error" : v >= 70 ? "bg-x-alert" : "bg-x-success";
  const sub: string[] = [];
  if (w.id === "fable-7d") {
    if (w.fableTokens != null) sub.push(`${tokens(w.fableTokens)} tokens · ${usd(w.fableCost ?? 0, 0)} desde ${w.fableSinceHuman}`);
    if (w.source === "manual" && w.manualAt) sub.push(`informado por você ${ago(w.manualAt)} · renova ${w.resetHuman}`);
    else sub.push("% oficial só no /usage do Claude Code");
  } else if (w.usedPct == null) {
    sub.push(w.note ?? "sem leitura");
  } else {
    sub.push(`renova ${w.resetHuman}`);
    if (w.id === "7d" && w.rateAvgPctPerHour != null && w.rateRecentPctPerHour != null && w.rateRecentPctPerHour > 0 && Math.max(w.rateAvgPctPerHour, w.rateRecentPctPerHour) > 2 * Math.min(w.rateAvgPctPerHour, w.rateRecentPctPerHour))
      sub.push(`média ${rate(w.rateAvgPctPerHour)} · agora ${rate(w.rateRecentPctPerHour)}`);
    else if (w.ratePctPerHour != null) sub.push(rate(w.ratePctPerHour));
    else if (w.note) sub.push(w.note);
  }
  return (
    <div className="min-w-0" data-window={w.id}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`flex items-center gap-1 ${size === "lg" ? "text-base tv:text-xl" : "text-sm"}`}>
          {w.label}
          {decisive && (
            <span className="inline-flex items-center text-xs font-medium text-x-highlight" title="Esta é a janela que decide o veredito">
              <CaretLeft weight="bold" aria-hidden />
              <span>decide</span>
            </span>
          )}
        </span>
        <span className="tabular text-sm font-medium tv:text-lg">{v == null ? (w.id === "fable-7d" && w.fableCost != null ? usd(w.fableCost, 0) : "—") : `${Math.round(v)} % usado`}</span>
      </div>
      {(v != null || w.id !== "fable-7d") && <div className={`mt-1 overflow-hidden rounded-full bg-muted ${size === "lg" ? "h-2.5 tv:h-3" : "h-2"}`} role="meter" aria-valuenow={v ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={w.label}>
        {v != null && <motion.div className={`h-full rounded-full ${color}`} initial={reduce ? false : { width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />}
      </div>}
      <div className="mt-1 text-xs text-muted-foreground tv:text-sm">{sub.join(" · ")}</div>
    </div>
  );
}

/** Proveniência (G6): fonte · idade · sessão. */
function Provenance({ v }: { v: Verdict }) {
  useTick();
  if (!v.readAt) return null;
  return (
    <p className={`text-xs tv:text-sm ${v.state === "stale" ? "font-medium text-x-alert" : "text-muted-foreground"}`}>
      {v.state === "stale" ? `última leitura ${ago(v.readAt)} — o Claude Code precisa estar aberto` : `leitura oficial ${ago(v.readAt)}`}
      {v.sessionTail ? ` · sessão …${v.sessionTail}` : ""}
    </p>
  );
}

export function VerdictBlock({ onSettings, layout = "stack" }: { onSettings: () => void; layout?: "stack" | "wide" }) {
  const s = useSnapshot();
  if (!s?.verdict)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  const v = s.verdict;
  const view = STATE_VIEW[v.state === "stale" ? v.underlying ?? "stale" : v.state];
  const size = layout === "wide" ? "lg" : "md";
  return (
    <section aria-label="Veredito" className="flex flex-col gap-4">
      <div className="flex gap-3">
        <motion.span layout className={`w-1 shrink-0 rounded-full ${view.bar}`} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold uppercase tracking-wide tv:text-sm ${view.text}`}>{view.label}</span>
            {v.state === "stale" && <Badge tone="muted">leitura antiga</Badge>}
          </div>
          <p className={`text-pretty font-semibold leading-snug tracking-tight ${layout === "wide" ? "text-xl xl:text-2xl tv:text-[1.875rem]" : "text-lg md:text-xl"}`} data-testid="verdict-headline">
            {v.headline.replace(/^(Tranquilo|Atenção|Crítico)\. /, "")}
          </p>
          <Provenance v={v} />
          {v.state === "missing" && (
            <Button variant="outline" size="sm" className="mt-1 self-start" onClick={onSettings}>
              <GearSix /> Como ativar
            </Button>
          )}
        </div>
      </div>
      {v.windows.length > 0 && (
        <div className="flex flex-col gap-3 tv:gap-4">
          {v.windows.map((w) => (
            <WindowBar key={w.id} w={w} decisive={v.decisive === w.id && v.state !== "missing"} size={size} />
          ))}
        </div>
      )}
      {v.state === "missing" && s.autonomy.basis === "trend" && <p className="text-sm text-muted-foreground">{s.autonomy.verdict}</p>}
    </section>
  );
}

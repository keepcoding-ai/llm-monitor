// Veredito no shell (plano §3, G1/G6/G9): frase + estado, três barras com reset
// humano e marcador da janela que decide, selo de proveniência. Fixo no shell —
// se quebra, quebra o build, nunca o dono.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Badge, Button, Skeleton } from "@atrium/core-ui";
import { CaretLeft, GearSix } from "@phosphor-icons/react";
import type { Verdict, VerdictState, VerdictWindow } from "../shared/snapshot";
import { ago, tokens, usd, useSnapshot } from "./sdk";
import { AutoAnalysisToggle } from "./auto-analysis";

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

/** Window names for the narrow one-line form, where the three sit side by side. */
const SHORT_LABEL: Record<VerdictWindow["id"], string> = { "5h": "5 h", "7d": "Semana", "fable-7d": "Fable" };

const rate = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} %/h`);

/**
 * One limit window. Two forms, switched by the height of the widget body:
 * low body = one line (label · bar · %), or label and % over the bar when the card is narrow (the three
 * sit side by side); from `tall-sm` up = label row, bar and the "renova…" line.
 * The window that decides the verdict keeps that last line even when space is short.
 */
function WindowBar({ w, decisive }: { w: VerdictWindow; decisive: boolean }) {
  const reduce = useReducedMotion();
  const v = w.usedPct == null ? null : Math.max(0, Math.min(100, w.usedPct));
  const color = v == null ? "" : v >= 90 ? "bg-x-error" : v >= 70 ? "bg-x-alert" : "bg-x-success";
  const sub: string[] = [];
  if (w.id === "fable-7d") {
    if (w.source === "official") sub.push(`renova ${w.resetHuman}`);
    if (w.fableTokens != null) sub.push(`${tokens(w.fableTokens)} tokens · ${usd(w.fableCost ?? 0, 0)} desde ${w.fableSinceHuman}`);
    if (w.source === "manual" && w.manualAt) sub.push(`informado por você ${ago(w.manualAt)} · renova ${w.resetHuman}`);
    else if (w.source !== "official") sub.push("% oficial indisponível — informe em Ajustes");
  } else if (w.usedPct == null) {
    sub.push(w.note ?? "sem leitura");
  } else {
    sub.push(`renova ${w.resetHuman}`);
    if (w.id === "7d" && w.rateAvgPctPerHour != null && w.rateRecentPctPerHour != null && w.rateRecentPctPerHour > 0 && Math.max(w.rateAvgPctPerHour, w.rateRecentPctPerHour) > 2 * Math.min(w.rateAvgPctPerHour, w.rateRecentPctPerHour))
      sub.push(`média ${rate(w.rateAvgPctPerHour)} · agora ${rate(w.rateRecentPctPerHour)}`);
    else if (w.ratePctPerHour != null) sub.push(rate(w.ratePctPerHour));
    else if (w.note) sub.push(w.note);
  }
  const value = v == null ? (w.id === "fable-7d" && w.fableCost != null ? usd(w.fableCost, 0) : "—") : `${Math.round(v)} %`;
  const hasBar = v != null || w.id !== "fable-7d";
  const fill = v != null && <motion.div className={`h-full rounded-full ${color}`} initial={reduce ? false : { width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />;
  return (
    <div className="min-w-0" data-window={w.id}>
      {/* low body: one line */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs tall-sm:hidden @lg:flex-nowrap @lg:gap-2 @lg:text-sm">
        <span className={`min-w-0 flex-1 truncate @lg:w-32 @lg:flex-none ${decisive ? "font-semibold" : ""}`}>
          <span className="@lg:hidden">{SHORT_LABEL[w.id]}</span>
          <span className="hidden @lg:inline">{w.label}</span>
        </span>
        <span className="order-3 h-1.5 min-w-0 basis-full overflow-hidden rounded-full bg-muted @lg:order-none @lg:h-2 @lg:flex-1 @lg:basis-auto">{fill}</span>
        <span className="tabular shrink-0 text-right font-medium @lg:w-12">{value}</span>
      </div>
      <div className="hidden tall-sm:block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1 text-sm tall-md:@lg:text-base tv:text-xl">
            {w.label}
            {decisive && (
              <span className="inline-flex items-center text-xs font-medium text-x-highlight" title="Esta é a janela que decide o veredito">
                <CaretLeft weight="bold" aria-hidden />
                <span>decide</span>
              </span>
            )}
          </span>
          <span className="tabular text-sm font-medium tv:text-lg">{v == null ? value : `${value} usado`}</span>
        </div>
        {hasBar && (
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted tall-md:@lg:h-2.5 tv:h-3" role="meter" aria-valuenow={v ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={w.label}>
            {fill}
          </div>
        )}
        <div className={`mt-1 text-xs text-muted-foreground tv:text-sm ${decisive ? "" : "hidden tall-lg:block tall-md:@lg:block"}`}>{sub.join(" · ")}</div>
      </div>
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

/**
 * Fills the grid cell and adapts to it (width: `@lg:` · height: `tall-*:`).
 * Low body: the sentence (two lines) and one-line bars. Taller: full bars, provenance and the
 * auto-analysis switch. Wide: sentence on the left, bars on the right.
 */
export function VerdictBlock({ onSettings }: { onSettings: () => void }) {
  const s = useSnapshot();
  if (!s?.verdict)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="hidden h-10 w-full tall-sm:block" />
        <Skeleton className="hidden h-10 w-full tall-md:block" />
      </div>
    );
  const v = s.verdict;
  const view = STATE_VIEW[v.state === "stale" ? v.underlying ?? "stale" : v.state];
  const prefix = /^(Tranquilo|Atenção|Crítico)\. /.exec(v.headline)?.[0] ?? "";
  // cota apertada (ou análises já desligadas): o toggle fica onde a decisão nasce
  const showToggle = ["attention", "critical", "exhausted"].includes(v.underlying ?? v.state) || !s.pulse.enabled;
  return (
    <section aria-label="Veredito" className="grid h-full min-h-0 content-start gap-x-8 gap-y-1.5 tall-sm:gap-y-3 @lg:grid-cols-2 @lg:grid-rows-[auto_minmax(0,1fr)] @lg:content-stretch">
      <div className="flex min-w-0 gap-3 @lg:row-span-2 @lg:self-center tall-md:@lg:row-span-1 tall-md:@lg:self-start">
        <motion.span layout className={`w-1 shrink-0 rounded-full ${view.bar}`} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1 tall-sm:gap-1.5">
          <div className="hidden flex-wrap items-center gap-2 tall-sm:flex">
            <span className={`text-xs font-semibold uppercase tracking-wide tv:text-sm ${view.text}`}>{view.label}</span>
            {v.state === "stale" && <Badge tone="muted">leitura antiga</Badge>}
          </div>
          <p className="line-clamp-3 text-pretty text-base font-semibold leading-snug tracking-tight @3xl:text-lg tall-sm:line-clamp-none tall-sm:text-lg tall-md:@lg:text-xl tall-lg:@lg:text-2xl tv:text-[1.875rem]" data-testid="verdict-headline">
            {/* low body has no state label: the sentence keeps its opening word */}
            {prefix && <span className={`tall-sm:hidden ${view.text}`}>{prefix}</span>}
            {v.headline.slice(prefix.length)}
          </p>
          <div className="hidden tall-sm:block">
            <Provenance v={v} />
          </div>
          {v.state === "missing" && (
            <Button variant="outline" size="sm" className="mt-1 self-start" onClick={onSettings}>
              <GearSix /> Como ativar
            </Button>
          )}
        </div>
      </div>
      {v.windows.length > 0 && (
        <div className="grid min-w-0 grid-cols-3 gap-2 @lg:flex @lg:flex-col @lg:justify-center @lg:gap-1.5 tall-sm:flex tall-sm:flex-col tall-sm:justify-center tall-sm:gap-3 tall-lg:@lg:gap-5 @lg:col-start-2 @lg:row-span-2 @lg:row-start-1 tv:gap-4">
          {v.windows.map((w) => (
            <WindowBar key={w.id} w={w} decisive={v.decisive === w.id && v.state !== "missing"} />
          ))}
        </div>
      )}
      {showToggle && (
        <div className="hidden self-end tall-xl:block tall-md:@lg:block @lg:col-start-1 @lg:row-start-2">
          <AutoAnalysisToggle compact model={s.pulse.model} />
        </div>
      )}
      {v.state === "missing" && s.autonomy.basis === "trend" && <p className="hidden text-sm text-muted-foreground tall-sm:block">{s.autonomy.verdict}</p>}
    </section>
  );
}

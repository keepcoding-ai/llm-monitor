// Estado "fora do ar": o que a interface diz quando o serviço para de responder.
// Princípio: nunca deixar a pessoa confundir a última leitura com dado vivo.
// - reconnecting (soluço de até ~10 s): só o cabeçalho muda, sem piscar o painel.
// - down: faixa no fluxo + painel dessaturado (data-stale no <main>) + título da aba.
import { useEffect } from "react";
import { Alert, AlertDescription, AlertTitle, StatusDot, type StatusDotStatus } from "@atrium/core-ui";
import { Plugs, ArrowsClockwise } from "@phosphor-icons/react";
import { ago, reconnectNow, useLink, useLive, type Link } from "./sdk";
import { useTick } from "./verdict";

const since = (ms: number | null) => (ms == null ? null : ago(new Date(ms).toISOString()));

/** StatusDot do core-ui tem três estados: running (vivo), attention (soluço), idle (apagado = fora do ar). */
const DOT: Record<Link, { status: StatusDotStatus; label: string }> = {
  live: { status: "running", label: "Ao vivo" },
  reconnecting: { status: "attention", label: "Reconectando" },
  down: { status: "idle", label: "Fora do ar" },
};

export function LinkDot() {
  const link = useLink();
  return <StatusDot status={DOT[link].status} label={DOT[link].label} />;
}

/** Cabeçalho: "ao vivo · há 5s" / "reconectando…" / "fora do ar · última leitura há 12 min". */
export function LinkStatus() {
  const link = useLink();
  const last = useLive((s) => s.lastEventAt);
  const hasSnap = useLive((s) => s.snapshot != null);
  useTick();
  const text =
    link === "live"
      ? hasSnap ? `ao vivo · ${since(last)}` : "conectando…"
      : link === "reconnecting"
        ? "reconectando…"
        : last ? `fora do ar · última leitura ${since(last)}` : "fora do ar";
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <LinkDot />
      <span className={`truncate ${link === "down" ? "font-medium text-x-error" : ""}`}>{text}</span>
    </span>
  );
}

/** Prefixa o título da aba enquanto o serviço está fora do ar. */
export function useDownTitle() {
  const link = useLink();
  useEffect(() => {
    const PREFIX = "● Fora do ar — ";
    const base = document.title.startsWith(PREFIX) ? document.title.slice(PREFIX.length) : document.title;
    document.title = link === "down" ? PREFIX + base : base;
    return () => {
      document.title = base;
    };
  }, [link]);
}

/** Faixa no fluxo quando o serviço está fora do ar (não no soluço). */
export function ServiceDownNotice() {
  const link = useLink();
  const last = useLive((s) => s.lastEventAt);
  const hasSnap = useLive((s) => s.snapshot != null);
  useTick();
  if (link !== "down") return null;
  return (
    <Alert tone="error" className="mb-4" role="status" aria-live="polite">
      <Plugs weight="light" aria-hidden="true" />
      <AlertTitle>Serviço fora do ar</AlertTitle>
      <AlertDescription>
        {hasSnap ? (
          <p>
            Os números abaixo <strong>não são ao vivo</strong>: são a última leitura, recebida {since(last)}. Atualizam sozinhos quando o serviço voltar.
          </p>
        ) : (
          <p>Nada foi lido ainda porque o serviço não responde. Assim que ele voltar, a leitura começa sozinha.</p>
        )}
        <p className="text-xs">
          Para subir: <kbd className="font-mono">llm-monitor</kbd> no Win+R, ou <kbd className="font-mono">npm run dev</kbd> na pasta do projeto.
        </p>
        {/* ação abaixo do texto, nunca sobre ele: em 390 px o canto direito não comporta */}
        <button type="button" className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4 xl:min-h-0" onClick={reconnectNow}>
          <ArrowsClockwise weight="light" aria-hidden="true" /> Tentar agora
        </button>
      </AlertDescription>
    </Alert>
  );
}

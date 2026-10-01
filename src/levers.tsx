// Alavancas reusadas pelos widgets (uma vez, aqui — nunca copiadas entre versões).
// SonnetLever: troca o modelo padrão do Claude Code para Sonnet até a renovação da
// semana — confirmação na linha, cópia de segurança, desfazer por 10 s, volta sozinha.
import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@atrium/core-ui";
import { call, useSnapshot } from "./sdk";

export function SonnetLever({ until, untilHuman, row }: { until: string | null; untilHuman: string; row: (action: ReactNode) => ReactNode }) {
  const s = useSnapshot();
  const [phase, setPhase] = useState<"idle" | "confirm" | "busy" | "undo">("idle");
  const [left, setLeft] = useState(10);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "undo") return;
    if (left <= 0) {
      setPhase("idle");
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, left]);
  const temp = s?.tempDefault;
  if (temp && phase !== "undo") return <>{row(<span className="text-right text-xs text-muted-foreground">padrão em {temp.model}<br />até {untilHuman}</span>)}</>;
  if (phase === "confirm" || phase === "busy")
    return (
      <>
      {row(null)}
      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex flex-col gap-2 rounded-md bg-muted/60 p-3">
        <span className="text-sm">Trocar o padrão do Claude Code para Sonnet até {untilHuman}? Vale para a sessão inteira, não só para os subagentes; volta sozinho na renovação.</span>
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" disabled={phase === "busy"} onClick={() => setPhase("idle")}>Cancelar</Button>
          <Button
            size="sm"
            disabled={phase === "busy" || !until}
            onClick={async () => {
              setPhase("busy");
              setErr(null);
              try {
                await call("/control/claude/temporary", { body: { model: "sonnet", until } });
                setLeft(10);
                setPhase("undo");
              } catch (e) {
                setErr((e as Error).message);
                setPhase("idle");
              }
            }}
          >
            Trocar
          </Button>
        </div>
      </motion.div>
      </>
    );
  if (phase === "undo")
    return (
      <>
      {row(null)}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 p-3">
        <span className="text-sm text-x-success">Padrão em Sonnet até {untilHuman}, com cópia de segurança.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await call("/control/claude/temporary/undo", { body: {} });
            } catch (e) {
              setErr((e as Error).message);
            }
            setPhase("idle");
          }}
        >
          Desfazer ({left})
        </Button>
      </div>
      </>
    );
  return (
    <>
      {row(<Button size="sm" variant="outline" onClick={() => setPhase("confirm")}>Sonnet</Button>)}
      {err && <span className="text-xs text-x-error">{err}</span>}
    </>
  );
}


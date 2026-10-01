// Sugestões v2: regras determinísticas + achados do pulso, e o botão de
// escalada quando o pulso pediu um modelo maior (nunca automático para fable).
import { useState } from "react";
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { ArrowFatLinesUp } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { call, useSnapshot } from "../../src/sdk";

const bar: Record<string, string> = { info: "border-l-x-info", notice: "border-l-x-notice", warning: "border-l-x-warning", alert: "border-l-x-alert" };

export default function Sugestoes() {
  const s = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!s) return null;
  const esc = s.pulse.last?.escalation;
  const canEscalate = esc && esc.status === "aguardando" && (esc.model === "sonnet" || esc.model === "opus");
  return (
    <div className="flex flex-col gap-3">
      {canEscalate && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-l-4 border-l-x-highlight p-3">
          <span className="text-sm">O último pulso pediu uma análise com {esc.model}.</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await call<{ status: string; note?: string }>("/pulse/escalate", { body: {} });
                setMsg(r.status + (r.note ? ` — ${r.note}` : ""));
              } catch (e) {
                setMsg((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ArrowFatLinesUp /> {busy ? "Analisando…" : `Escalar para ${esc.model}`}
          </Button>
          {msg && <span className="w-full text-xs text-muted-foreground">{msg}</span>}
        </div>
      )}
      {esc?.model === "fable" && <p className="text-sm text-x-highlight">O pulso pediu fable: isso só roda com a sua liberação.</p>}
      {s.suggestions.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nada a sugerir agora</EmptyTitle>
            <EmptyDescription>As regras e o pulso não encontraram nada que valha sua atenção.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <motion.ul className="flex flex-col gap-2" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.05 } } }}>
          {s.suggestions.map((g) => (
            <motion.li key={g.id} variants={{ h: { opacity: 0, y: 8 }, s: { opacity: 1, y: 0 } }} className={`rounded-md border border-l-4 bg-card p-3 ${bar[g.level]}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium leading-snug">{g.title}</span>
                <Badge tone={g.origin === "pulso" ? "info" : "muted"}>{g.origin}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{g.detail}</p>
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

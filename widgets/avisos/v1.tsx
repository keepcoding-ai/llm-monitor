// Avisos (plano G6): o que mudou e você precisa saber. Nada é descartado em silêncio.
import { AnimatePresence, motion } from "framer-motion";
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { ago, call, useSnapshot } from "../../src/sdk";

const tone = { info: "info", warning: "warning", alert: "warning", error: "error" } as const;
const nome: Record<string, string> = { info: "informação", warning: "atenção", alert: "alerta", error: "erro" };

export default function Avisos() {
  const s = useSnapshot();
  if (!s) return null;
  const open = s.flags.filter((f) => !f.ack);
  const seen = s.flags.length - open.length;
  if (open.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nenhum aviso</EmptyTitle>
          <EmptyDescription>O monitor avisa aqui quando algo muda.{seen ? ` ${seen} já marcados como ciente.` : ""}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {open.map((f) => (
          <motion.li key={f.key} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 24 }} className="rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium leading-snug">{f.title}</span>
              <Badge tone={tone[f.level]}>{nome[f.level]}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{f.count > 1 ? `${f.count} vezes · ` : ""}{ago(f.lastSeen)}</span>
              <Button size="sm" variant="outline" onClick={() => call(`/flags/${encodeURIComponent(f.key)}/ack`, { body: {} })}>
                Ciente
              </Button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

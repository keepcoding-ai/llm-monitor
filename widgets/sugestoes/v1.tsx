// Sugestões: regras determinísticas + achados do pulso.
import { Badge, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { motion } from "framer-motion";
import { useSnapshot } from "../../src/sdk";

const bar: Record<string, string> = { info: "border-l-x-info", notice: "border-l-x-notice", warning: "border-l-x-warning", alert: "border-l-x-alert" };

export default function Sugestoes() {
  const s = useSnapshot();
  if (!s) return null;
  if (s.suggestions.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nada a sugerir agora</EmptyTitle>
          <EmptyDescription>As regras e o pulso não encontraram nada que valha sua atenção.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
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
  );
}

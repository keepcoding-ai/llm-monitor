// Por quê hoje (plano G3): as 3 causas do gasto de hoje, cada uma com a sua
// alavanca. A troca de modelo padrão é real (com cópia de segurança), pede
// confirmação na linha e pode ser desfeita por 10 s.
import { AnimatePresence, motion } from "framer-motion";
import { Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@atrium/core-ui";
import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { usd, useSnapshot } from "../../src/sdk";
import { SonnetLever } from "../../src/levers";
import { go } from "../../src/router";

const pct = (n: number) => `${Math.round(n * 100)} %`;

function useBreakLater() { const [b, setB] = useState(false); useEffect(() => { const t = setTimeout(() => setB(true), 3000); return () => clearTimeout(t); }, []); if (b) throw new Error("peça quebrada de propósito para a prova do passo 7"); }

export default function PorQue() {
  useBreakLater();
  const s = useSnapshot();
  if (!s) return null;
  const total = s.today.cost;
  if (total < 0.01)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Sem consumo hoje</EmptyTitle>
          <EmptyDescription>As causas aparecem assim que o Claude Code gastar algo.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const w7 = s.verdict.windows.find((w) => w.id === "7d");
  const untilHuman = w7?.resetHuman.split(",")[0] ?? "a renovação";
  const fable = s.byModel.filter((m) => /fable|mythos/.test(m.key)).reduce((x, m) => x + m.cost, 0);
  const proj = s.byProjectToday[0];
  const rows = [
    s.sidechainToday.opusShare > 0.01 && { k: "sub", label: "Subagentes em Opus", share: s.sidechainToday.opusShare, lever: true },
    fable > 0.01 && { k: "fable", label: "Fable", share: fable / total, action: <Button size="sm" variant="ghost" onClick={() => go("semana")}>ver <ArrowRight /></Button> },
    proj && proj.cost > 0.01 && { k: "proj", label: `Projeto ${proj.key.split(/[\/]/).filter(Boolean).pop() ?? proj.key}`, share: proj.cost / total, action: <Button size="sm" variant="ghost" onClick={() => go("semana")}>ver <ArrowRight /></Button> },
  ].filter(Boolean) as { k: string; label: string; share: number; action?: React.ReactNode; lever?: boolean }[];
  const rowOf = (r: (typeof rows)[number], action: React.ReactNode) => (
    <div className="flex min-h-12 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm">{r.label}</div>
        <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground/40" style={{ width: `${Math.min(100, r.share * 100)}%` }} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular w-10 text-right text-sm font-medium">{pct(r.share)}</span>
        {action}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Gasto de hoje</span>
        <span className="tabular font-semibold">{usd(total, 0)}</span>
      </div>
      <motion.ul className="flex flex-col divide-y" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.05 } } }}>
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li key={r.k} layout variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} className="flex flex-col gap-1 pb-2">
              {r.lever ? <SonnetLever until={w7?.resetsAt ?? null} untilHuman={untilHuman} row={(a) => rowOf(r, a)} /> : rowOf(r, r.action)}
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
      <p className="text-xs text-muted-foreground">Parcela do gasto de hoje, em equivalente API.</p>
    </div>
  );
}

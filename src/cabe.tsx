// "Cabe?" (plano §4, G2) — widget de código (builtin); o card e o título vêm da célula da grade.
// Toque num preset: a resposta sai na hora (sem LLM) e a estimativa fica
// registrada para o monitor conferir depois de uma janela.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Skeleton, ToggleGroup, ToggleGroupItem } from "@atrium/core-ui";
import { answerCabe } from "../shared/cabe";
import { call, usd, useSnapshot } from "./sdk";

const fmtPct = (n: number) => (n < 1 ? n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : Math.round(n).toLocaleString("pt-BR"));

export function CabeBlock() {
  const s = useSnapshot();
  const [pick, setPick] = useState<string>("");
  if (!s?.cabe)
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  const c = s.cabe;
  const preset = c.presets.find((p) => p.id === pick) ?? null;
  const ans = preset ? answerCabe(preset.usd, c, s.verdict) : null;
  return (
    <section aria-label="Cabe?" className="flex flex-col gap-3">
        {!c.enoughHistory && (
          <p className="text-sm text-muted-foreground" data-testid="cabe-sem-historico">
            Ainda sem histórico para estimar uma rodada:{" "}
            {c.historySince
              ? `${c.windowsClosed} de ${c.windowsNeeded} janelas de 5 h fechadas, registros desde ${new Date(c.historySince).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}; os valores aparecem com 3 semanas de uso.`
              : "nenhum uso registrado ainda."}
          </p>
        )}
        {c.presets.length > 0 && <p className="text-sm text-muted-foreground">Vou rodar…</p>}
        {c.presets.length > 0 && <ToggleGroup
          type="single"
          value={pick}
          onValueChange={(v: string) => {
            setPick(v);
            const p = c.presets.find((x) => x.id === v);
            if (p) void call("/cabe/estimate", { body: { preset: p.label, usd: p.usd } }).catch(() => undefined);
          }}
          variant="outline"
          size="sm"
          className="flex-wrap justify-start gap-1.5"
          aria-label="O que você vai rodar"
        >
          {c.presets.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} className="h-auto min-h-9 rounded-full! border! px-3 py-1" title={p.basis}>
              {p.label} <span className="tabular text-muted-foreground">{usd(p.usd, 0)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>}
        <AnimatePresence mode="wait" initial={false}>
          {ans && preset && (
            <motion.div key={preset.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-1" aria-live="polite" data-testid="cabe-answer">
              {ans.pctWeek != null ? (
                <p className="text-base font-medium">
                  ≈ {fmtPct(ans.pctWeek)} % da semana{ans.pct5h != null ? ` e ${fmtPct(ans.pct5h)} % da sessão de 5 h` : ""}.
                </p>
              ) : (
                <p className="text-base font-medium">≈ {usd(preset.usd, 0)} equivalente API.</p>
              )}
              {ans.after && <p className={`text-sm ${ans.fits === false ? "text-x-alert" : "text-muted-foreground"}`}>{ans.after}</p>}
              {ans.advice && <p className="text-sm font-medium text-x-alert">{ans.advice}</p>}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="text-xs text-muted-foreground">
          {c.usdPerPctWeek != null ? `1 % da semana ≈ ${usd(c.usdPerPctWeek, 0)} (aprendido de ${c.pairsWeek} leituras)` : `Ainda sem conversão para % do plano (${c.pairsWeek} de 6 leituras) — por enquanto, só US$.`}
          {c.presets.length > 0 && " · Valores do seu histórico, equivalente API."}
        </p>
    </section>
  );
}

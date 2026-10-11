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
  const rate = c.usdPerPctWeek != null ? `1 % da semana ≈ ${usd(c.usdPerPctWeek, 0)}` : null;
  // Fills the cell. Low body: the options in a compact 2-column grid and a one-line answer.
  // Taller (`tall-*:`): options become a 2-column grid that takes the spare height, the answer gets
  // its advice and the footnote sits at the bottom.
  return (
    <section aria-label="Cabe?" className="flex h-full min-h-0 flex-col gap-2 tall-md:gap-3">
      {!c.enoughHistory && (
        <p className="line-clamp-2 text-sm text-muted-foreground tall-md:line-clamp-none" data-testid="cabe-sem-historico">
          Ainda sem histórico para estimar uma rodada:{" "}
          {c.historySince
            ? `${c.windowsClosed} de ${c.windowsNeeded} janelas de 5 h fechadas, registros desde ${new Date(c.historySince).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}; os valores aparecem com 3 semanas de uso.`
            : "nenhum uso registrado ainda."}
        </p>
      )}
      {c.presets.length > 0 && <p className="hidden text-sm text-muted-foreground tall-lg:block">Vou rodar…</p>}
      {c.presets.length > 0 && (
        <div className="shrink-0 tall-md:max-h-64 tall-md:min-h-24 tall-md:flex-1">
          <ToggleGroup
            type="single"
            value={pick}
            onValueChange={(v: string) => {
              setPick(v);
              const p = c.presets.find((x) => x.id === v);
              if (p) void call("/cabe/estimate", { body: { preset: p.label, usd: p.usd } }).catch(() => undefined);
            }}
            variant="outline"
            size="sm"
            className="grid w-full grid-cols-2 gap-1 @sm:gap-1.5 tall-md:h-full tall-md:gap-2"
            aria-label="O que você vai rodar"
          >
            {c.presets.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id} className="h-auto min-h-7 min-w-0 justify-between gap-1.5 rounded-md! border! px-2 py-0.5 text-xs pointer-coarse:min-h-9 tall-sm:min-h-9 tall-sm:px-3 tall-sm:text-sm tall-md:h-full tall-md:flex-col tall-md:items-start tall-md:justify-center tall-md:gap-0 tall-md:rounded-lg!" title={p.basis}>
                <span className="min-w-0 max-w-full truncate">{p.label}</span> <span className="tabular shrink-0 text-muted-foreground">{usd(p.usd, 0)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {ans && preset ? (
          <motion.div key={preset.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="flex min-w-0 flex-col gap-0.5 tall-md:gap-1" aria-live="polite" data-testid="cabe-answer">
            <p className={`truncate text-sm font-medium tall-sm:whitespace-normal tall-md:text-base tall-lg:text-lg ${ans.fits === false ? "text-x-alert tall-sm:text-foreground" : ""}`}>
              {ans.pctWeek != null ? `≈ ${fmtPct(ans.pctWeek)} % da semana${ans.pct5h != null ? ` e ${fmtPct(ans.pct5h)} % da sessão de 5 h` : ""}.` : `≈ ${usd(preset.usd, 0)} equivalente API.`}
            </p>
            {ans.after && <p className={`hidden text-xs tall-sm:line-clamp-2 tall-md:line-clamp-none tall-md:text-sm ${ans.fits === false ? "text-x-alert" : "text-muted-foreground"}`}>{ans.after}</p>}
            {ans.advice && <p className="hidden text-sm font-medium text-x-alert tall-sm:block">{ans.advice}</p>}
          </motion.div>
        ) : (
          c.presets.length > 0 && (
            <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="line-clamp-1 text-xs text-muted-foreground tall-sm:line-clamp-2 tall-md:line-clamp-none tall-md:text-sm">
              <span className="tall-sm:hidden">Toque numa opção para ver o peso.</span>
              <span className="hidden tall-sm:inline">Toque numa opção para ver quanto ela pesa na semana e na sessão{rate ? <span className="tall-md:hidden"> · {rate}</span> : null}.</span>
            </motion.p>
          )
        )}
      </AnimatePresence>
      <p className="mt-auto hidden text-xs text-muted-foreground tall-lg:block">
        {rate ? `${rate} (aprendido de ${c.pairsWeek} leituras)` : `Ainda sem conversão para % do plano (${c.pairsWeek} de 6 leituras) — por enquanto, só US$.`}
        {c.presets.length > 0 && " · Valores do seu histórico, equivalente API."}
      </p>
    </section>
  );
}

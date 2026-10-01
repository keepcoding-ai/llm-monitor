// "Cabe?" (plano §4, G2): quanto uma rodada custa em % do plano e como fica o
// veredito depois dela. Puro — o cliente calcula a resposta na hora do toque.
import type { Verdict } from "./snapshot.ts";

export type CabePreset = { id: "leve" | "pesada" | "agentes" | "fable"; label: string; usd: number; basis: string };
export type Cabe = {
  presets: CabePreset[];
  /** true = ainda sem 4 semanas de histórico: valores genéricos, avisados na tela */
  generic: boolean;
  /** US$ equivalente por 1 ponto percentual — null sem leituras suficientes (< 6 pares) */
  usdPerPctWeek: number | null;
  usdPerPct5h: number | null;
  pairsWeek: number;
  pairs5h: number;
};

export type CabeAnswer = { pctWeek: number | null; pct5h: number | null; after: string; fits: boolean | null; advice: string | null };

export function answerCabe(usd: number, cabe: Cabe, v: Verdict | null, now = Date.now()): CabeAnswer {
  const pctWeek = cabe.usdPerPctWeek ? usd / cabe.usdPerPctWeek : null;
  const pct5h = cabe.usdPerPct5h ? usd / cabe.usdPerPct5h : null;
  const w7 = v?.windows.find((w) => w.id === "7d");
  const w5 = v?.windows.find((w) => w.id === "5h");
  if (pctWeek == null || !w7 || w7.usedPct == null) return { pctWeek, pct5h, after: "", fits: null, advice: null };
  const newWeek = w7.usedPct + pctWeek;
  const rate = w7.ratePctPerHour ?? 0;
  const reset = w7.resetsAt ? Date.parse(w7.resetsAt) : null;
  const hit = rate > 0 ? now + ((100 - newWeek) / rate) * 3600_000 : null;
  const sessionBlows = pct5h != null && w5?.usedPct != null && w5.usedPct + pct5h >= 100;
  const fits = newWeek < 100 && (!hit || !reset || hit >= reset);
  const word = newWeek >= 100 ? "Sem Claude" : newWeek >= 90 || !fits ? (newWeek >= 90 ? "Crítico" : "Atenção") : newWeek >= 70 ? "Atenção" : "Tranquilo";
  const day = w7.resetHuman.split(",")[0];
  let after = `Depois: ${word}, semana em ${Math.round(newWeek)} % — você ${fits ? "ainda chega" : "não chega"} ${day ? `à renovação de ${day}` : "à renovação"}.`;
  if (sessionBlows) after += ` A sessão de 5 h não comporta: estoura antes de renovar ${w5!.resetHuman}.`;
  const already = v?.windows.some((w) => w.exhausts) ?? false;
  const advice = already || !fits ? `Melhor rodar com Sonnet ou depois de ${w7.resetHuman}.` : null;
  return { pctWeek, pct5h, after, fits, advice };
}

// A série única normalizada: um registro por resposta de modelo (Claude Code)
// ou por modelo-por-turno (Soul). Append-only em state/collector/series.jsonl,
// espelhada em memória para os derivados.
import { P, appendJsonl, readJsonl, readJson, type PriceTable } from "./store.ts";

export type UsageRecord = {
  /** chave de deduplicação: message.id (CC) ou session:turn:model (Soul) */
  id: string;
  ts: number;
  source: "claude-code" | "soul";
  account: string;
  model: string;
  project: string;
  session: string;
  /** subagente (sidechain) */
  side: boolean;
  /** chamada feita pela própria plataforma */
  platform: boolean;
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
  thinking: number;
  webSearch: number;
  /** custo equivalente API em USD; null = sem preço conhecido */
  cost: number | null;
  /** quem precificou: tabela do app ou a do Soul */
  priceTable: string;
};

export const records: UsageRecord[] = [];
export const seen = new Set<string>();

export function loadSeries(): void {
  for (const r of readJsonl<UsageRecord>(P.series)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    records.push(r);
  }
  records.sort((a, b) => a.ts - b.ts);
}

export function addRecords(rows: UsageRecord[]): number {
  const fresh = rows.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (fresh.length === 0) return 0;
  appendJsonl(P.series, fresh);
  for (const r of fresh) records.push(r);
  // a maioria chega em ordem; reordena só se preciso
  const n = records.length;
  if (n > fresh.length && records[n - fresh.length - 1].ts > fresh[0].ts) records.sort((a, b) => a.ts - b.ts);
  return fresh.length;
}

let priceCache: { table: PriceTable; at: number } | null = null;
export function prices(): PriceTable {
  if (!priceCache || Date.now() - priceCache.at > 30_000) {
    priceCache = { table: readJson<PriceTable>(P.prices, { version: "?", source: "", models: [] }), at: Date.now() };
  }
  return priceCache.table;
}

export function priceFor(model: string) {
  return prices().models.find((m) => model.startsWith(m.match)) ?? null;
}

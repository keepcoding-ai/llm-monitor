// A série única normalizada: um registro por resposta de modelo (Claude Code)
// ou por modelo-por-turno (Soul). Append-only em state/collector/series.jsonl,
// espelhada em memória para os derivados.
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { P, appendJsonl, readJson, type PriceTable } from "./store.ts";

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

/** Só a janela quente fica em memória: o derive nunca olha além de ~31 dias (série diária de 30 dias).
 *  O arquivo series.jsonl segue completo em disco. */
export const RETENTION_MS = 35 * 24 * 3600_000;

export const records: UsageRecord[] = [];
/** Dedupe: hash de 53 bits do id (um número por registro, em vez de uma string de ~50 B + o próprio campo).
 *  Colisão: ~n²/2^54 ≈ 1e-5 para 440 mil registros — um registro perdido, nunca um duplicado. Registro mais
 *  velho que a janela quente não é retido nem deduplicado em memória; os hashes só saem no reinício. */
export const seen = new Set<number>();

/** cyrb53 (hash não criptográfico, 53 bits). */
export function hashId(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** total de linhas na série (disco), inclusive as que saíram da memória — é o que o painel mostra. */
export const stats = { total: 0 };

// strings de baixa cardinalidade (conta, modelo, projeto, sessão, tabela de preço) compartilham uma instância
const pool = new Map<string, string>();
const intern = (v: string): string => {
  let x = pool.get(v);
  if (x === undefined) pool.set(v, (x = v));
  return x;
};
function compact(r: UsageRecord): UsageRecord {
  r.id = ""; // o id só serve ao dedupe (hash em `seen`); nenhum derivado o lê
  r.source = intern(r.source) as UsageRecord["source"];
  r.account = intern(r.account);
  r.model = intern(r.model);
  r.project = intern(r.project);
  r.session = intern(r.session);
  r.priceTable = intern(r.priceTable);
  return r;
}

/** Lê series.jsonl em fluxo (nunca o arquivo inteiro como string) e retém só a janela quente. */
export async function loadSeries(): Promise<void> {
  if (!existsSync(P.series)) return;
  const cutoff = Date.now() - RETENTION_MS;
  const rl = createInterface({ input: createReadStream(P.series, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r: UsageRecord;
    try {
      r = JSON.parse(line) as UsageRecord;
    } catch {
      continue; // última linha rasgada durante append
    }
    stats.total++;
    if (r.ts < cutoff) continue;
    const h = hashId(r.id);
    if (seen.has(h)) continue;
    seen.add(h);
    records.push(compact(r));
  }
  records.sort((a, b) => a.ts - b.ts);
}

/** Solta da memória o que saiu da janela quente (chamado a cada ciclo). */
export function trimSeries(now = Date.now()): number {
  const cutoff = now - RETENTION_MS;
  let n = 0;
  while (n < records.length && records[n].ts < cutoff) n++;
  if (n > 0) records.splice(0, n);
  return n;
}

export function addRecords(rows: UsageRecord[]): number {
  const cutoff = Date.now() - RETENTION_MS;
  const fresh = rows.filter((r) => {
    const h = hashId(r.id);
    if (seen.has(h)) return false;
    // fora da janela quente: vai ao disco mas não é retido (não há como deduplicar sem o id em memória)
    if (r.ts >= cutoff) seen.add(h);
    return true;
  });
  if (fresh.length === 0) return 0;
  appendJsonl(P.series, fresh);
  stats.total += fresh.length;
  const hot = fresh.filter((r) => r.ts >= cutoff);
  for (const r of hot) records.push(compact(r)); // (depois do appendJsonl: o id já foi ao disco)
  // a maioria chega em ordem; reordena só se preciso
  const n = records.length;
  if (hot.length && n > hot.length && records[n - hot.length - 1].ts > hot[0].ts) records.sort((a, b) => a.ts - b.ts);
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

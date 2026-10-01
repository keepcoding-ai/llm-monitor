// Coletor do Soul. Contas, fila e saúde vêm SÓ pela API do provider-pool
// (o segredo nunca passa por aqui; listAccounts já devolve mascarado).
// Consumo: <raiz do agente>/.soul/profiles/<perfil>/sessions/<sessão>/usage.jsonl,
// gravado pelo motor ao fim de cada turno (soul/session/sessionUsage.ts).
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { activate, listAccounts, readPool, type PoolAccount } from "@codrstudio/provider-pool";
import { EFFORT_LEVELS, MODEL_LABELS } from "@codrstudio/model-matrix";
import { expandHome, loadConfig } from "../store.ts";
import { raiseFlag, clearFlag } from "../flags.ts";
import { addRecords, prices, type UsageRecord } from "../series.ts";
import { readNewLines, walk } from "./incremental.ts";

export type SoulAccountView = Omit<PoolAccount, "secretRef">;
export type SoulPoolView = {
  dir: string;
  label: string;
  ok: boolean;
  error?: string;
  accounts: SoulAccountView[];
  activeId?: string;
  order: string[];
  sessionFiles: number;
};

export const soulVocabulary = { models: [...MODEL_LABELS], efforts: [...EFFORT_LEVELS] };

let lastPools: SoulPoolView[] = [];
export function soulPools(): SoulPoolView[] {
  return lastPools;
}

/** Pastas onde o motor grava sessões para um pool: `<pool>/profiles` (pool é a
 *  própria pasta .soul de uma raiz de agente) + raízes extras configuradas. */
function sessionRoots(dir: string, extra: string[]): string[] {
  const roots = [join(dir, "profiles")];
  for (const e of extra) roots.push(expandHome(e));
  return roots.filter((r) => existsSync(r));
}

export async function collectSoul(): Promise<number> {
  const cfg = loadConfig();
  const views: SoulPoolView[] = [];
  let added = 0;
  for (const pc of cfg.soulPools) {
    const dir = expandHome(pc.dir);
    const view: SoulPoolView = { dir: pc.dir, label: pc.label, ok: true, accounts: [], order: [], sessionFiles: 0 };
    try {
      if (!existsSync(dir)) throw new Error("pasta do pool não existe");
      view.accounts = listAccounts(dir).map(({ secretRef: _s, ...a }) => a);
      const pool = readPool(dir);
      view.activeId = pool.activeCredentialId;
      view.order = pool.order;
      clearFlag(`soul-pool:${pc.dir}`);
    } catch (e) {
      view.ok = false;
      view.error = (e as Error).message;
      raiseFlag({ key: `soul-pool:${pc.dir}`, kind: "fonte-falhou", level: "error", title: `Pool do Soul ilegível: ${pc.label}`, detail: view.error });
    }
    const account = view.accounts.find((a) => a.isActive)?.label ?? pc.label;
    const files: string[] = [];
    for (const r of sessionRoots(dir, pc.sessionRoots)) files.push(...(await walk(r, (n) => n === "usage.jsonl", 6)));
    view.sessionFiles = files.length;
    for (const f of files) {
      const rows: UsageRecord[] = [];
      await readNewLines(f, (line) => {
        let j: any;
        try {
          j = JSON.parse(line);
        } catch {
          return;
        }
        const ts = Date.parse(j.timestamp ?? "");
        if (!ts || !j.model) return;
        // o usage.jsonl não grava a conta que serviu o turno: atribuímos ao
        // pool (e à conta ativa dele no momento da coleta), declarado na UI.
        const profile = basename(dirname(dirname(dirname(f))));
        rows.push({
          id: `soul:${j.sessionId}:${j.turnId}:${j.model}`,
          ts,
          source: "soul",
          account: `${pc.label} · ${account}`,
          model: j.model,
          project: profile,
          session: j.sessionId ?? "",
          side: false,
          platform: false,
          input: Number(j.inputTokens ?? 0),
          output: Number(j.outputTokens ?? 0),
          cacheWrite: Number(j.cacheCreationInputTokens ?? 0),
          cacheWrite1h: 0,
          cacheRead: Number(j.cacheReadInputTokens ?? 0),
          thinking: 0,
          webSearch: 0,
          cost: typeof j.costUSD === "number" ? j.costUSD : null,
          priceTable: j.priceTable ?? prices().version,
        });
      });
      added += addRecords(rows);
    }
    views.push(view);
  }
  lastPools = views;
  return added;
}

export function activateSoulAccount(poolDir: string, accountId: string): void {
  const cfg = loadConfig();
  const pc = cfg.soulPools.find((p) => p.dir === poolDir);
  if (!pc) throw new Error("pool não mapeado");
  activate(expandHome(pc.dir), accountId);
}

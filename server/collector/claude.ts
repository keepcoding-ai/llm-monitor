// Coletor do Claude Code: ~/.claude/projects/**/*.jsonl (inclui subagents/).
// Determinístico, sem LLM. Lê só o que cresceu desde o último ciclo.
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { AGENT_WORK, HOME, P, readJson, writeJson } from "../store.ts";
import { raiseFlag } from "../flags.ts";
import { addRecords, priceFor, prices, type UsageRecord } from "../series.ts";
import { readNewLines, walk } from "./incremental.ts";

export const CLAUDE_DIR = join(HOME, ".claude");
const PROJECTS = join(CLAUDE_DIR, "projects");

// Campos de `message.usage` que o coletor entende. Qualquer outro vira marca.
const KNOWN_USAGE = new Set([
  "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens",
  "output_tokens_details", "server_tool_use", "service_tier", "cache_creation", "inference_geo",
  "iterations", "speed", "fallback_credit",
]);
const KNOWN_OUTPUT_DETAILS = new Set(["thinking_tokens"]);
const KNOWN_SERVER_TOOL = new Set(["web_search_requests", "web_fetch_requests"]);
const KNOWN_CACHE_CREATION = new Set(["ephemeral_1h_input_tokens", "ephemeral_5m_input_tokens"]);

type Meta = { monitorStartedAt: number; lastVersion?: string; versionsSeen: string[]; filesScanned: number; lastCycleMs: number; backfillDone: boolean };

export function loadMeta(): Meta {
  const m = readJson<Partial<Meta>>(P.collectorMeta, {});
  return { monitorStartedAt: m.monitorStartedAt ?? Date.now(), versionsSeen: m.versionsSeen ?? [], filesScanned: m.filesScanned ?? 0, lastCycleMs: m.lastCycleMs ?? 0, backfillDone: m.backfillDone ?? false, lastVersion: m.lastVersion };
}
export const meta = loadMeta();

/** Conta ativa do Claude Code — só identidade (e-mail/nome), nunca token. */
export function activeClaudeAccount(): { email: string; name: string } | null {
  try {
    const j = JSON.parse(readFileSync(join(HOME, ".claude.json"), "utf8"));
    const o = j?.oauthAccount;
    if (!o?.emailAddress) return null;
    return { email: String(o.emailAddress), name: String(o.displayName ?? o.fullName ?? "") };
  } catch {
    return null;
  }
}

function checkKeys(obj: Record<string, unknown> | undefined, known: Set<string>, path: string, file: string) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (!known.has(k)) {
      raiseFlag({
        key: `unknown-field:${path}.${k}`,
        kind: "campo-desconhecido",
        level: "alert",
        title: `Campo novo no registro do Claude Code: ${path}.${k}`,
        detail: `O coletor ainda não interpreta este campo (o valor não entra na conta). Visto pela última vez em uma sessão de ${file}.`,
      });
    }
  }
}

function projectLabel(cwd: string | undefined, file: string): string {
  if (cwd) {
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts.slice(-2).join("/");
  }
  return file.split(sep).slice(-2, -1)[0] ?? "?";
}

let versionCheckPending: string | null = null;

function parseLine(line: string, file: string, account: string, rows: UsageRecord[]) {
  // filtro barato antes do JSON.parse (a maioria das linhas não é resposta)
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  let j: any;
  try {
    j = JSON.parse(line);
  } catch {
    return;
  }
  if (j.type !== "assistant" || !j.message?.usage) return;
  const m = j.message;
  const id: string = m.id ?? j.uuid;
  const model: string = m.model ?? "?";
  if (model === "<synthetic>") return;
  const u = m.usage;
  checkKeys(u, KNOWN_USAGE, "usage", projectLabel(j.cwd, file));
  checkKeys(u.output_tokens_details, KNOWN_OUTPUT_DETAILS, "usage.output_tokens_details", projectLabel(j.cwd, file));
  checkKeys(u.server_tool_use, KNOWN_SERVER_TOOL, "usage.server_tool_use", projectLabel(j.cwd, file));
  checkKeys(u.cache_creation, KNOWN_CACHE_CREATION, "usage.cache_creation", projectLabel(j.cwd, file));
  if (j.version && j.version !== meta.lastVersion) {
    if (!meta.versionsSeen.includes(j.version)) meta.versionsSeen.push(j.version);
    // versão nova (maior do que a última registrada) é anomalia a revisar
    if (!meta.lastVersion || cmpVer(j.version, meta.lastVersion) > 0) {
      if (meta.lastVersion && meta.backfillDone) versionCheckPending = j.version;
      meta.lastVersion = j.version;
    }
  }
  const ts = Date.parse(j.timestamp ?? "") || Date.now();
  const cw = Number(u.cache_creation_input_tokens ?? 0);
  const cw1h = Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const rec: UsageRecord = {
    id,
    ts,
    source: "claude-code",
    // o jsonl não grava a conta: só o que chega depois de o monitor estar de pé
    // é atribuído à conta ativa no momento; o histórico anterior fica "anterior ao monitor".
    account: ts >= meta.monitorStartedAt ? account : "anterior ao monitor",
    model,
    project: projectLabel(j.cwd, file),
    session: j.sessionId ?? "",
    side: Boolean(j.isSidechain) || file.includes(`${sep}subagents${sep}`),
    platform: typeof j.cwd === "string" && j.cwd.toLowerCase().startsWith(AGENT_WORK.toLowerCase()),
    input: Number(u.input_tokens ?? 0),
    output: Number(u.output_tokens ?? 0),
    cacheWrite: cw,
    cacheWrite1h: cw1h,
    cacheRead: Number(u.cache_read_input_tokens ?? 0),
    thinking: Number(u.output_tokens_details?.thinking_tokens ?? 0),
    webSearch: Number(u.server_tool_use?.web_search_requests ?? 0),
    cost: null,
    priceTable: prices().version,
  };
  const p = priceFor(model);
  if (p) {
    rec.cost =
      (rec.input * p.input + rec.output * p.output + (cw - cw1h) * p.cacheWrite5m + cw1h * p.cacheWrite1h + rec.cacheRead * p.cacheRead) / 1e6;
  } else {
    raiseFlag({
      key: `price-unknown:${model}`,
      kind: "preco-desconhecido",
      level: "warning",
      title: `Sem preço para o modelo ${model}`,
      detail: "Os tokens contam, mas o custo deste modelo fica de fora até a tabela de preço ganhar uma linha para ele.",
    });
  }
  rows.push(rec);
}

function cmpVer(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export async function collectClaude(onProgress?: (n: number) => void): Promise<number> {
  const t0 = Date.now();
  const files = await walk(PROJECTS, (n) => n.endsWith(".jsonl"), 6);
  const acct = activeClaudeAccount();
  const account = acct?.email ?? "conta não identificada";
  let added = 0;
  let i = 0;
  for (const f of files) {
    const rows: UsageRecord[] = [];
    await readNewLines(
      f,
      (l) => parseLine(l, f, account, rows),
      () =>
        raiseFlag({
          key: `truncated:${f}`,
          kind: "arquivo-encolheu",
          level: "warning",
          title: "Um histórico do Claude Code encolheu",
          detail: "O arquivo ficou menor do que já tinha sido lido; foi relido do início (registros repetidos são descartados pelo id).",
        }),
    );
    added += addRecords(rows);
    if (++i % 50 === 0) onProgress?.(i);
  }
  if (versionCheckPending) {
    raiseFlag({
      key: `cc-version:${versionCheckPending}`,
      kind: "versao-mudou",
      level: "info",
      title: `Claude Code mudou para ${versionCheckPending}`,
      detail: "Formato dos registros pode ter mudado; o coletor marca campos novos automaticamente. O próximo pulso revisa.",
    });
    versionCheckPending = null;
  }
  meta.filesScanned = files.length;
  meta.lastCycleMs = Date.now() - t0;
  meta.backfillDone = true;
  writeJson(P.collectorMeta, meta);
  return added;
}

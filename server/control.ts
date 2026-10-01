// Controle do modelo/effort padrão do Claude Code: ~/.claude/settings.json.
// Leitura-modifica-escrita preservando TODO o resto do arquivo, backup antes,
// e só por ação explícita na UI.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME, P, appendJsonl } from "./store.ts";

/** Alvo do controle. A variável existe só para provar a função contra uma
 *  cópia (desenvolvimento); o uso normal escreve o arquivo real do usuário. */
export function settingsPath(): string {
  return process.env.LLM_MONITOR_CLAUDE_SETTINGS || join(HOME, ".claude", "settings.json");
}

export function readClaudeSettings(): Record<string, unknown> {
  const p = settingsPath();
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeClaudeDefaults(change: { model?: string | null; effortLevel?: string | null }): { backup: string | null; model: unknown; effortLevel: unknown } {
  const p = settingsPath();
  const raw = existsSync(p) ? readFileSync(p, "utf8") : "{}";
  const obj = JSON.parse(raw) as Record<string, unknown>; // lança se o arquivo estiver inválido: não escrevemos por cima
  let backup: string | null = null;
  if (existsSync(p)) {
    mkdirSync(P.backups, { recursive: true });
    backup = join(P.backups, `settings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    copyFileSync(p, backup);
  }
  for (const k of ["model", "effortLevel"] as const) {
    if (!(k in change)) continue;
    const v = change[k];
    if (v === null || v === "") delete obj[k];
    else obj[k] = v;
  }
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = raw.match(/\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : 2;
  const tmp = `${p}.llm-monitor.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, indent).replace(/\n/g, eol) + eol, "utf8");
  renameSync(tmp, p);
  appendJsonl(P.decisions, [{ at: new Date().toISOString(), kind: "claude-defaults", change, backup }]);
  return { backup, model: obj.model, effortLevel: obj.effortLevel };
}

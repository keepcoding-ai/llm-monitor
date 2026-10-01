#!/usr/bin/env node
// Statusline do LLM Monitor. O Claude Code passa um JSON via stdin a cada
// atualização da linha de status; aqui gravamos o snapshot (sem segredo
// algum: só modelo, versão e limites) e imprimimos uma linha curta.
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STATE = join(dirname(fileURLToPath(import.meta.url)), "state");
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(raw || "{}"); } catch { /* entrada inválida: grava só as chaves vazias */ }
  const rl = j.rate_limits ?? null;
  const snap = {
    at: new Date().toISOString(),
    version: j.version,
    model: j.model?.display_name ?? j.model?.id,
    keys: Object.keys(j),
    rateLimits: rl,
  };
  try {
    mkdirSync(STATE, { recursive: true });
    const p = join(STATE, "statusline.json");
    writeFileSync(p + ".tmp", JSON.stringify(snap, null, 2));
    renameSync(p + ".tmp", p);
    const pct = (w) => { const v = Number(w?.used_percentage ?? w?.usedPercentage ?? w?.utilization); return Number.isFinite(v) ? { usedPct: v, resetsAt: w.resets_at == null ? null : typeof w.resets_at === "number" ? new Date(w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at).toISOString() : String(w.resets_at) } : undefined; };
    if (rl) appendFileSync(join(STATE, "statusline-history.jsonl"), JSON.stringify({ at: snap.at, five: pct(rl.five_hour), seven: pct(rl.seven_day) }) + "\n");
  } catch { /* nunca quebrar a linha de status do Claude Code */ }
  const f = (w) => { const v = Number(w?.used_percentage ?? w?.utilization); return Number.isFinite(v) ? `${Math.round(v)}%` : "?"; };
  const model = snap.model ?? "";
  process.stdout.write(rl ? `${model} · 5h ${f(rl.five_hour)} · sem ${f(rl.seven_day)}` : `${model} · limites indisponíveis`);
});

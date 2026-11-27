#!/usr/bin/env node
// Statusline do LLM Monitor. O Claude Code passa um JSON via stdin a cada
// atualização da linha de status; aqui gravamos o snapshot (sem segredo
// algum: só modelo, versão e limites) e imprimimos uma linha curta.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    session: j.session_id ?? null,
    version: j.version,
    model: j.model?.display_name ?? j.model?.id,
    keys: Object.keys(j),
    rateLimits: rl,
    effort: typeof j.effort === "string" ? j.effort : (j.effort?.level ?? j.effort?.value ?? ""),
  };
  try {
    mkdirSync(STATE, { recursive: true });
    const p = join(STATE, "statusline.json");
    writeFileSync(p + ".tmp", JSON.stringify(snap, null, 2));
    renameSync(p + ".tmp", p);
    const pct = (w) => { const v = Number(w?.used_percentage ?? w?.usedPercentage ?? w?.utilization); return Number.isFinite(v) ? { usedPct: v, resetsAt: w.resets_at == null ? null : typeof w.resets_at === "number" ? new Date(w.resets_at < 1e12 ? w.resets_at * 1000 : w.resets_at).toISOString() : String(w.resets_at) } : undefined; };
    if (rl) appendFileSync(join(STATE, "statusline-history.jsonl"), JSON.stringify({ at: snap.at, session: snap.session, five: pct(rl.five_hour), seven: pct(rl.seven_day) }) + "\n");
  } catch { /* nunca quebrar a linha de status do Claude Code */ }
  const f = (w) => { const v = Number(w?.used_percentage ?? w?.utilization); return Number.isFinite(v) ? `${Math.round(v)}%` : "?"; };
  const model = snap.model ?? "";
  const eff = snap.effort ?? "";
  const tag = `${model}${eff ? " " + eff : ""}`;
  // Veredito do monitor (state/derived.json). Sem ele — monitor nunca subiu —, a linha fica como antes.
  let short = "";
  try { short = JSON.parse(readFileSync(join(STATE, "derived.json"), "utf8")).verdict?.short ?? ""; } catch { /* sem derivados ainda */ }
  short = short.replace(/[←-⯿]️?\s*/g, "").trim();
  // Fable ativo: alerta forte antes da linha (mesmo estilo da statusline do tether); os limites seguem depois.
  const probe = `${j.model?.id ?? ""} ${j.model?.display_name ?? ""}`;
  // Dentro do tether (TETHER_SLOT_ID), a própria linha já desenha alerta, modelo e esforço: aqui fica só o resto.
  const inTether = Boolean(process.env.TETHER_SLOT_ID);
  const alert = !inTether && /fable/i.test(probe) ? `\x1b[1;97;41m FABLE ATIVO: ${model.toUpperCase()}${eff ? " / " + eff.toUpperCase() : ""} \x1b[0m  ` : "";
  const head = inTether ? "" : `${tag}`;
  const lim = `5h ${f(rl?.five_hour)} · sem ${f(rl?.seven_day)}`;
  if (rl && short) process.stdout.write(`${alert}${inTether ? short : `${head} · ${short}`} · ${lim}`);
  else if (rl) process.stdout.write(`${alert}${inTether ? lim : `${head} · ${lim}`}`);
  else process.stdout.write(`${alert}${inTether ? "limites indisponíveis" : `${tag} · limites indisponíveis`}`);
});

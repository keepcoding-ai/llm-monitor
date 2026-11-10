#!/usr/bin/env node
// Centralized, deterministic token benchmark over ~/.claude/projects transcripts.
// Usage: node scripts/bench.mjs [--since 7d] [--project <substr>] [--session <id|current>] [--top N] [--out state/bench]
import { createReadStream, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createAnalyzer } from "./bench/engine.mjs";
import { buildReport, renderMarkdown } from "./bench/report.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { since: "7d", top: 10, out: "state/bench", project: "", session: "" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--since") a.since = argv[++i];
    else if (k === "--project") a.project = argv[++i] ?? "";
    else if (k === "--session") a.session = argv[++i] ?? "";
    else if (k === "--top") a.top = Math.max(1, Number(argv[++i]) || 10);
    else if (k === "--out") a.out = argv[++i];
    else { console.error(`argumento desconhecido: ${k}`); process.exit(2); }
  }
  return a;
}
export function parseSince(s) {
  const m = /^(\d+)\s*(m|h|d|w)$/.exec(s ?? "");
  if (!m) throw new Error(`--since inválido: ${s} (use 30m, 12h, 7d, 2w)`);
  return Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2]];
}

function* walk(dir, depth = 0) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth < 6) yield* walk(p, depth + 1);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield p;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  let session = args.session;
  if (session === "current") {
    session = process.env.CLAUDE_CODE_SESSION_ID ?? "";
    if (!session) { console.error("CLAUDE_CODE_SESSION_ID não definido; --session current indisponível."); process.exit(1); }
  }
  // when a session is requested, the mtime window does not apply unless --since was explicit
  const sinceExplicit = process.argv.includes("--since");
  const windowMs = session && !sinceExplicit ? Infinity : parseSince(args.since);
  const sinceMs = windowMs === Infinity ? 0 : Date.now() - windowMs;
  const prices = JSON.parse(readFileSync(join(ROOT, "state/prices.json"), "utf8"));
  const projectsDir = join(homedir(), ".claude", "projects");
  const proj = args.project.toLowerCase();

  const files = [];
  for (const f of walk(projectsDir)) {
    const rel = f.slice(projectsDir.length + 1);
    if (proj && !rel.split(/[\\/]/)[0].toLowerCase().includes(proj)) continue;
    if (session && !rel.includes(session)) continue;
    let st; try { st = statSync(f); } catch { continue; }
    if (st.mtimeMs < sinceMs) continue;
    files.push({ path: f, size: st.size, rel });
  }

  const an = createAnalyzer({ prices, sinceMs });
  let bytes = 0;
  for (const f of files) {
    const side = /[\\/]subagents[\\/]/.test(f.rel);
    const parts = f.rel.split(/[\\/]/);
    const info = { side, session: side ? parts[parts.length - 3] : basename(f.path, ".jsonl"), agentId: side ? basename(f.path, ".jsonl").replace(/^agent-/, "") : "" };
    bytes += f.size;
    const rl = createInterface({ input: createReadStream(f.path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"assistant"') && !line.includes('"tool_result"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      an.ingest(j, info);
    }
  }
  const res = an.finalize();
  const report = buildReport(res, { top: args.top, since: session && !sinceExplicit ? "tudo (sessão)" : args.since, project: args.project, session: session ? session.slice(0, 8) : "" });
  report.params.files = files.length;
  report.params.bytesRead = bytes;
  report.params.runtimeMs = Date.now() - t0;
  const out = resolve(ROOT, args.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "report.md"), renderMarkdown(report));

  const t = report.totals;
  const usd = (x) => "$" + x.toFixed(2);
  console.log(`bench: ${files.length} arquivos (${(bytes / 1e6).toFixed(0)} MB), ${res.ctxCount} contextos, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`custo total ${usd(t.cost.total)} · cacheRead ${(t.costShare.cacheRead * 100).toFixed(1)}% · cacheWrite ${(t.costShare.cacheWrite * 100).toFixed(1)}% · output ${(t.costShare.output * 100).toFixed(1)}% · input ${(t.costShare.input * 100).toFixed(1)}%`);
  console.log(`reconstruções de cache: ${report.idle.count} (${usd(report.idle.gross)}); achados: ${report.findings.length}`);
  console.log(`relatório: ${join(out, "report.md")}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

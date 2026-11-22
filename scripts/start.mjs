// Sobe o monitor em modo servido: um único processo node (bundle do server + front de dist/).
// Porta: LLM_MONITOR_PORT (padrão 4780). UI em http://localhost:<porta>/llm-monitor/
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundle = join(root, "dist-server", "index.mjs");
if (!existsSync(bundle) || !existsSync(join(root, "dist", "index.html"))) {
  console.error("[llm-monitor] build ausente: rode `npm run build` antes de `npm start`.");
  process.exit(1);
}
// teto do heap do V8: o server é leve; o limite evita crescimento silencioso (override: LLM_MONITOR_HEAP_MB)
const heap = process.env.LLM_MONITOR_HEAP_MB || "128";
const child = spawn(process.execPath, [`--max-old-space-size=${heap}`, bundle], { cwd: root, stdio: "inherit" });
console.log(`[llm-monitor] server pid ${child.pid} — http://localhost:${process.env.LLM_MONITOR_PORT || 4780}/llm-monitor/`);
const stop = () => {
  if (!child.killed) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (c) => process.exit(c ?? 0));

// Sobe backend (4780) e front (4781) juntos; Ctrl+C derruba os dois pelos PIDs
// que este script criou (nunca por nome).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kids = [
  spawn(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js")], { cwd: root, stdio: "inherit" }),
];
console.log(`[llm-monitor] backend pid ${kids[0].pid}, front pid ${kids[1].pid} — abra http://127.0.0.1:4781/llm-monitor/`);
const stop = () => {
  for (const k of kids) if (!k.killed) k.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const k of kids) k.on("exit", (c) => { console.error(`[llm-monitor] processo ${k.pid} saiu (${c}); encerrando`); stop(); });

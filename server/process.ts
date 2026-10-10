// Encerramento de árvore de processos. Sempre por PID, nunca por nome.
import { spawn } from "node:child_process";

/** Mata o processo e todos os descendentes. Windows: `taskkill /T /F`; senão sinal no grupo
 *  (o filho precisa ter sido lançado com `detached: true` para ser líder de grupo). */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!Number.isInteger(pid) || pid <= 0) return resolve();
    if (process.platform === "win32") {
      const k = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      k.on("error", () => resolve());
      k.on("close", () => resolve());
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* já morreu */
      }
    }
    resolve();
  });
}

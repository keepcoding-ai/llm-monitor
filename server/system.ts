// Reinício adiado: o server se substitui sozinho quando o chat fica ocioso.
// O lançador (app desktop) não ressobe filho que saiu, então nada aqui depende dele.
import { spawn } from "node:child_process";
import type { Server } from "node:http";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { STATE } from "./store.ts";
import { publish } from "./bus.ts";

let restartPending = false;
let isIdle: () => boolean = () => true;
let closeListener: () => Promise<void> = async () => undefined;
let exiting = false;

/** O boot injeta como saber se o chat está ocioso e como fechar o listener. */
export function configureSystem(opts: { isIdle: () => boolean; closeListener: () => Promise<void> }): void {
  isIdle = opts.isIdle;
  closeListener = opts.closeListener;
}

export const isRestartPending = () => restartPending;

/** Marca o reinício como pendente; executa na hora se o chat já está ocioso. */
export function requestRestart(): void {
  if (!restartPending) {
    restartPending = true;
    publish("system", { restartPending: true });
  }
  void maybeRestart();
}

/** Chamado quando o chat termina (ou ao pedir). */
export async function maybeRestart(): Promise<void> {
  if (!restartPending || exiting || !isIdle()) return;
  exiting = true;
  try {
    await closeListener();
    mkdirSync(STATE, { recursive: true });
    const log = openSync(join(STATE, "restart.log"), "a");
    const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    closeSync(log);
  } catch (e) {
    exiting = false;
    console.error("[llm-monitor] reinício falhou:", (e as Error).message);
    return;
  }
  process.exit(0);
}

/** Sobe o listener tentando de novo se a porta ainda está com o processo antigo (auto-substituição). */
export function listenWithRetry(
  start: () => Server,
  opts: { port: number; hostname: string; onListening: () => void; maxMs?: number },
): Server {
  const deadline = Date.now() + (opts.maxMs ?? 10_000);
  const server = start();
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE" && Date.now() < deadline) {
      setTimeout(() => server.listen(opts.port, opts.hostname), 400);
      return;
    }
    console.error(`[llm-monitor] não consegui a porta ${opts.port}:`, e.message);
    process.exit(1);
  });
  server.once("listening", opts.onListening);
  return server;
}

/** Fecha o listener derrubando também as conexões abertas (SSE nunca termina sozinho). */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 2000);
    server.close(() => {
      clearTimeout(t);
      resolve();
    });
    server.closeAllConnections();
  });
}

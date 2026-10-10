// Seleção de arquivos por ciclo: walk completo só na subida e a cada
// FULL_WALK_INTERVAL_MS; nos ciclos intermediários, stat só no conjunto quente
// (mtime nas últimas HOT_WINDOW_MS). Funções puras + um orquestrador com
// walk/stat injetáveis (testável sem disco).
import { stat } from "node:fs/promises";

export const FULL_WALK_INTERVAL_MS = 5 * 60_000;
export const HOT_WINDOW_MS = 24 * 3_600_000;

export type Seen = { mtimeMs: number; size: number };
export type FileIndex = { files: Map<string, Seen>; lastWalkAt: number | null };
export type Changed = { path: string; seen: Seen };

export const newFileIndex = (): FileIndex => ({ files: new Map(), lastWalkAt: null });

/** Walk completo na subida (nunca feito) ou quando o intervalo venceu. */
export function shouldFullWalk(now: number, lastWalkAt: number | null, intervalMs = FULL_WALK_INTERVAL_MS): boolean {
  return lastWalkAt === null || now - lastWalkAt >= intervalMs;
}

/** Arquivos conhecidos cujo último mtime visto está dentro da janela quente. */
export function selectHotSet(files: ReadonlyMap<string, Seen>, now: number, windowMs = HOT_WINDOW_MS): string[] {
  const out: string[] = [];
  for (const [p, s] of files) if (now - s.mtimeMs <= windowMs) out.push(p);
  return out;
}

export async function statSeen(path: string): Promise<Seen | null> {
  try {
    const st = await stat(path);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null; // ENOENT (ou ilegível): o arquivo sai da lista
  }
}

/**
 * Devolve os arquivos que precisam de leitura neste ciclo (novos ou com
 * mtime/tamanho diferente do último lido). O índice só avança via `commit`,
 * depois que a leitura deu certo. Arquivos sumidos saem do índice.
 */
export async function pickChanged(
  index: FileIndex,
  now: number,
  walkFn: () => Promise<string[]>,
  statFn: (p: string) => Promise<Seen | null> = statSeen,
): Promise<Changed[]> {
  let paths: string[];
  if (shouldFullWalk(now, index.lastWalkAt)) {
    paths = await walkFn();
    index.lastWalkAt = now;
    const alive = new Set(paths);
    for (const p of [...index.files.keys()]) if (!alive.has(p)) index.files.delete(p);
    for (const p of paths) if (!index.files.has(p)) index.files.set(p, { mtimeMs: 0, size: -1 }); // nunca lido
  } else {
    paths = selectHotSet(index.files, now);
  }
  const out: Changed[] = [];
  for (const path of paths) {
    const seen = await statFn(path);
    if (!seen) {
      index.files.delete(path);
      continue;
    }
    const prev = index.files.get(path);
    if (!prev || prev.mtimeMs !== seen.mtimeMs || prev.size !== seen.size) out.push({ path, seen });
  }
  return out;
}

export function commit(index: FileIndex, c: Changed): void {
  index.files.set(c.path, c.seen);
}

// Leitura incremental de arquivos jsonl: guarda o offset (em bytes) por arquivo
// e só lê o que cresceu. Nunca relê tudo a cada ciclo.
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { P, readJson, writeJson } from "../store.ts";

type Off = { offset: number; size: number };
let offsets: Record<string, Off> = readJson<Record<string, Off>>(P.offsets, {});
let dirty = false;

export function saveOffsets(): void {
  if (!dirty) return;
  writeJson(P.offsets, offsets);
  dirty = false;
}

/** Lista arquivos com o nome dado (ou sufixo) recursivamente, até `depth`. */
export async function walk(root: string, accept: (name: string) => boolean, depth = 8): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, d: number) {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (d > 0 && e.name !== "node_modules") await rec(p, d - 1);
      } else if (accept(e.name)) out.push(p);
    }
  }
  await rec(root, depth);
  return out;
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Entrega as linhas completas novas de `path` desde o último offset.
 * Linha final sem \n fica para o próximo ciclo. Arquivo que encolheu é relido
 * do zero e `onTruncate` é chamado (anomalia).
 */
export async function readNewLines(
  path: string,
  onLine: (line: string) => void,
  onTruncate?: () => void,
): Promise<number> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return 0;
  }
  const cur = offsets[path] ?? { offset: 0, size: 0 };
  if (st.size < cur.offset) {
    onTruncate?.();
    cur.offset = 0;
  }
  if (st.size === cur.offset) return 0;
  const fh = await open(path, "r");
  let pos = cur.offset;
  let carry: Buffer = Buffer.alloc(0);
  let lines = 0;
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    while (pos < st.size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(CHUNK, st.size - pos), pos);
      if (bytesRead === 0) break;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead);
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl === -1) {
        carry = Buffer.from(data);
      } else {
        const body = data.toString("utf8", 0, lastNl);
        carry = Buffer.from(data.subarray(lastNl + 1));
        for (const l of body.split("\n")) {
          if (l && l !== "\r") {
            onLine(l);
            lines++;
          }
        }
      }
      pos += bytesRead;
      await new Promise((r) => setImmediate(r)); // não trava o servidor na carga inicial
    }
  } finally {
    await fh.close();
  }
  // não avança sobre a linha incompleta
  offsets[path] = { offset: pos - carry.length, size: st.size };
  dirty = true;
  return lines;
}

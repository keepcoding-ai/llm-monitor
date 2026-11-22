// Modo servido: o próprio Hono entrega o front compilado (dist/) sob /llm-monitor/ — sem processo Vite.
// Inclui o fallback de SPA (rota sem extensão => index.html) e os widgets compilados sob demanda.
import type { Hono } from "hono";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { APP_ROOT } from "./store.ts";
import { serveWidget } from "./widget-serve.ts";

export const DIST = join(APP_ROOT, "dist");
const BASE = "/llm-monitor";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** Arquivo de dist/ para o caminho pedido (sem escapar da pasta), ou null. */
function resolveFile(rel: string): { file: string; size: number; mtimeMs: number } | null {
  const file = resolve(DIST, "." + sep + rel);
  if (file !== DIST && !file.startsWith(DIST + sep)) return null;
  try {
    const st = statSync(file);
    return st.isFile() ? { file, size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
}

function send(req: Request, f: { file: string; size: number; mtimeMs: number }, relPath: string): Response {
  const etag = `W/"${f.size.toString(16)}-${Math.floor(f.mtimeMs).toString(16)}"`;
  // assets/ tem hash no nome (imutável); o resto (index.html, sw.js, shared/*, manifest) revalida sempre
  const cache = relPath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  const headers = { etag, "cache-control": cache, "content-type": MIME[extname(f.file).toLowerCase()] ?? "application/octet-stream" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(Readable.toWeb(createReadStream(f.file)) as ReadableStream, { headers: { ...headers, "content-length": String(f.size) } });
}

/** Registra o front compilado e os widgets. Sem dist/ (modo dev) não registra nada. */
export function mountStatic(app: Hono): boolean {
  if (!existsSync(join(DIST, "index.html"))) return false;

  app.get(`${BASE}/widgets/:id/:file`, async (c) => {
    const m = /^v(\d+)\.tsx$/.exec(c.req.param("file"));
    if (!m) return c.text("não encontrado", 404);
    const out = await serveWidget(c.req.param("id"), Number(m[1]), c.req.header("if-none-match"));
    if (out.status === 304) return new Response(null, { status: 304, headers: { etag: out.etag! } });
    if (out.status !== 200) return c.text(out.error ?? "erro", out.status);
    return new Response(out.code, { headers: { "content-type": MIME[".js"], "cache-control": "no-cache", etag: out.etag! } });
  });

  app.get(BASE, (c) => c.redirect(`${BASE}/`));
  app.get(`${BASE}/*`, (c) => {
    const rel = decodeURIComponent(c.req.path.slice(BASE.length + 1));
    if (rel.startsWith("api/")) return c.json({ error: "não encontrado" }, 404);
    const hit = rel ? resolveFile(rel) : null;
    if (hit) return send(c.req.raw, hit, rel);
    if (extname(rel)) return c.text("não encontrado", 404); // arquivo que não existe não vira SPA
    const index = resolveFile("index.html");
    return index ? send(c.req.raw, index, "index.html") : c.text("front não compilado (npm run build)", 503);
  });
  return true;
}

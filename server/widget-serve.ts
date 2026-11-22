// Widgets (widgets/<id>/v<n>.tsx) criados em runtime pelo chat. No dev o Vite os transforma; no modo
// servido (sem Vite) o esbuild compila cada versão sob demanda e reescreve os imports compartilhados
// (react, core-ui, src/sdk, src/ui...) para as entradas ESM estáveis /llm-monitor/shared/*.js que o
// build do front publica — assim o widget usa a MESMA instância do app (ver shared/widget-modules.ts).
// Versões são imutáveis; o JS compilado fica num cache pequeno por (arquivo, mtime).
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { APP_ROOT, WIDGETS_DIR } from "./store.ts";
import { WIDGET_BARE, WIDGET_LOCAL, sharedName } from "../shared/widget-modules.ts";

const BASE = "/llm-monitor";
const MAX_CACHE = 64;
const cache = new Map<string, string>();
let inflight = 0;

type Esbuild = typeof import("esbuild");
let esbuild: Esbuild | null = null;

const sharedUrl = (id: string) => `${BASE}/${sharedName(id)}.js`;

async function compile(file: string): Promise<string> {
  esbuild ??= await import("esbuild");
  const eb = esbuild;
  const res = await eb.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    logLevel: "silent",
    absWorkingDir: APP_ROOT,
    plugins: [
      {
        name: "lm-shared",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (a.kind === "entry-point") return undefined;
            if ((WIDGET_BARE as readonly string[]).includes(a.path)) return { path: sharedUrl(a.path), external: true };
            if (a.path.startsWith(".") || isAbsolute(a.path)) {
              const abs = resolve(a.resolveDir, a.path);
              const rel = relative(APP_ROOT, abs).split("\\").join("/").replace(/\.(tsx?|jsx?)$/, "");
              if ((WIDGET_LOCAL as readonly string[]).includes(rel)) return { path: sharedUrl(rel), external: true };
              return undefined; // arquivo local do próprio widget: entra no bundle dele
            }
            return { errors: [{ text: `o módulo "${a.path}" não está disponível para widgets (permitidos: ${[...WIDGET_BARE, ...WIDGET_LOCAL].join(", ")})` }] };
          });
        },
      },
    ],
  });
  return res.outputFiles[0].text;
}

export type WidgetOut = { status: 200 | 304 | 400 | 404 | 500; code?: string; etag?: string; error?: string };

export async function serveWidget(id: string, v: number, ifNoneMatch?: string): Promise<WidgetOut> {
  if (!/^[a-z0-9-]+$/.test(id) || !Number.isInteger(v)) return { status: 404, error: "não encontrado" };
  const file = join(WIDGETS_DIR, id, `v${v}.tsx`);
  if (!existsSync(file)) return { status: 404, error: "não encontrado" };
  const mtime = statSync(file).mtimeMs;
  const key = `${file}:${mtime}`;
  const etag = `W/"${Math.floor(mtime).toString(16)}"`;
  if (ifNoneMatch === etag && cache.has(key)) return { status: 304, etag };
  let code = cache.get(key);
  if (code === undefined) {
    inflight++;
    try {
      code = await compile(file);
    } catch (e) {
      return { status: 500, error: (e as Error).message };
    } finally {
      // o esbuild mantém um processo filho vivo; solta-o quando ninguém está compilando
      if (--inflight === 0) void esbuild?.stop();
    }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, code);
  }
  return { status: 200, code, etag };
}

// Empacota server/index.ts em dist-server/index.mjs (ESM, um arquivo): o server roda com `node`,
// sem tsx em runtime. O esbuild fica de fora (carregado só sob demanda, para compilar widgets).
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [join(root, "server/index.ts")],
  outfile: join(root, "dist-server/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["esbuild"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  legalComments: "none",
  logLevel: "info",
});

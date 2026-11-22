import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WIDGET_BARE, WIDGET_LOCAL, sharedName } from "./shared/widget-modules.ts";
import brand from "./brand.generated.json" with { type: "json" }; // cores/nome derivados por scripts/derive-brand.mjs

const ROOT = fileURLToPath(new URL(".", import.meta.url)).replaceAll("\\", "/");
const requireCjs = createRequire(import.meta.url);

// Entradas ESM estáveis (shared/<nome>.js) dos módulos que os widgets importam — só no build.
// O Rollup junta tudo num grafo único: o widget carregado em runtime usa a MESMA instância de
// react/sdk/ui que o app (server/widget-serve.ts reescreve os imports do widget para estas URLs).
const VIRTUAL = "virtual:lm-shared/";
function widgetSharedEntries(): { plugin: import("vite").Plugin; input: Record<string, string> } {
  const input: Record<string, string> = {};
  for (const id of [...WIDGET_BARE, ...WIDGET_LOCAL]) input[sharedName(id)] = VIRTUAL + id;
  const cjsNames = (spec: string) => Object.keys(requireCjs(spec)).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
  return {
    input,
    plugin: {
      name: "lm-widget-shared",
      apply: "build",
      resolveId: (id) => (id.startsWith(VIRTUAL) ? "\0" + id : null),
      load(id) {
        if (!id.startsWith("\0" + VIRTUAL)) return null;
        const spec = id.slice(("\0" + VIRTUAL).length);
        if (spec === "react" || spec === "react/jsx-runtime") return `export { ${cjsNames(spec).join(", ")} } from "${spec}";\nexport { default } from "${spec}";`;
        if ((WIDGET_LOCAL as readonly string[]).includes(spec)) return `export * from "${ROOT}${spec}";`;
        return `export * from "${spec}";`;
      },
    },
  };
}
const widgetShared = widgetSharedEntries();

// UI sob o prefixo /llm-monitor/ (nunca dona da raiz); API em /llm-monitor/api/v1.
// Os widgets (widgets/<id>/v<n>.tsx) são servidos pelo próprio Vite e carregados
// por import dinâmico — ver server/widgets.ts para a justificativa.
export default defineConfig({
  base: "/llm-monitor/",
  plugins: [
    widgetShared.plugin,
    react(),
    tailwindcss(),
    // PWA instalável (Android + iPhone). Ícones/splash vêm do brand (scripts/derive-brand.mjs → public/).
    // registerType "prompt": o registro e o aviso de versão nova vivem em src/pwa.tsx.
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["favicon.ico", "favicon.svg", "favicon-light.svg", "favicon-dark.svg", "apple-touch-icon.png", "masked-icon.svg"],
      manifest: {
        id: "/llm-monitor/",
        name: brand.name,
        short_name: brand.shortName,
        description: "Quanto Claude você ainda tem — e o que fazer com isso.",
        lang: "pt-BR",
        start_url: "/llm-monitor/",
        scope: "/llm-monitor/",
        display: "standalone",
        orientation: "any",
        theme_color: brand.background.light,
        background_color: brand.background.light,
        categories: ["productivity", "utilities"],
        // ?v=2 nos ícones "any": cache-busting p/ o Chrome re-baixar após a troca (fundo transparente)
        icons: [
          { src: "icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/icon.svg?v=2", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
        screenshots: [
          { src: "screenshots/narrow.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "Agora: veredito e quanto Claude resta" },
          { src: "screenshots/wide.png", sizes: "1280x800", type: "image/png", form_factor: "wide", label: "Painel completo com o chat ao lado" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        globIgnores: ["splash/**", "screenshots/**", "assets/heic-to-*.js"], // splash é do iOS (pedido sob demanda); heic-to (3 MB) só carrega ao anexar HEIC
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // shared/_phosphor-icons_react.js (~5 MB): os widgets importam ícones à vontade
        // navegação offline cai no shell, mas nunca em /llm-monitor/api (nem no SSE)
        navigateFallbackDenylist: [/^\/llm-monitor\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // leituras da API: rede primeiro, cai pro último valor em 4 s. O SSE (/events) nunca é cacheado.
            urlPattern: ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/llm-monitor/api/v1/") && !url.pathname.endsWith("/events"),
            handler: "NetworkFirst",
            options: { cacheName: "llm-monitor-api", networkTimeoutSeconds: 4, expiration: { maxEntries: 60, maxAgeSeconds: 86400 }, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
      devOptions: { enabled: true, suppressWarnings: true, navigateFallbackAllowlist: [/^\/llm-monitor\//] },
    }),
  ],
  resolve: {
    // core-ui entra por file: (link). preserveSymlinks faz as dependências dele
    // (radix-ui, vaul...) resolverem a partir do node_modules deste app.
    preserveSymlinks: true,
    dedupe: ["react", "react-dom", "framer-motion"],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.LLM_MONITOR_WEB_PORT || 4781),
    strictPort: true,
    proxy: { "/llm-monitor/api": { target: `http://127.0.0.1:${process.env.LLM_MONITOR_PORT || 4780}`, changeOrigin: false } },
    watch: { ignored: ["**/state/**"] },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: { index: ROOT + "index.html", ...widgetShared.input },
      preserveEntrySignatures: "exports-only",
      output: { entryFileNames: (c) => (c.name.startsWith("shared/") ? "[name].js" : "assets/[name]-[hash].js") },
    },
  },
  // core-ui is a linked source package that gets pre-bundled (preserveSymlinks); Vite only
  // invalidates that cache when the lockfile changes, so kit fixes never arrived. Re-bundle on every start.
  optimizeDeps: { force: true, include: ["react", "react-dom", "framer-motion", "@phosphor-icons/react"] },
});

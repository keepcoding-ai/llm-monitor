import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// UI sob o prefixo /llm-monitor/ (nunca dona da raiz); API em /llm-monitor/api/v1.
// Os widgets (widgets/<id>/v<n>.tsx) são servidos pelo próprio Vite e carregados
// por import dinâmico — ver server/widgets.ts para a justificativa.
export default defineConfig({
  base: "/llm-monitor/",
  plugins: [react(), tailwindcss()],
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
  optimizeDeps: { include: ["react", "react-dom", "framer-motion", "@phosphor-icons/react"] },
});

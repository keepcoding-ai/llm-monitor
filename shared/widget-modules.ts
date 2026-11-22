// Módulos que os widgets (widgets/<id>/v<n>.tsx) podem importar. No dev o Vite resolve tudo;
// no modo servido (dist/) o build expõe cada um como entrada ESM estável em /shared/<nome>.js
// (mesma instância que o app usa) e o server reescreve os imports do widget para essas URLs.

/** Pacotes (specifier nu). */
export const WIDGET_BARE = ["react", "react/jsx-runtime", "@atrium/core-ui", "@phosphor-icons/react", "framer-motion"] as const;

/** Arquivos do app, por caminho relativo à raiz, sem extensão. */
export const WIDGET_LOCAL = ["src/sdk", "src/ui", "src/levers", "src/router", "shared/reserve"] as const;

/** Nome do arquivo publicado (sem `.js`) para um specifier nu ou caminho local. */
export const sharedName = (id: string) => "shared/" + id.replace(/[/@]/g, "_");

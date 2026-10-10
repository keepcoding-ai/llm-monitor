# MINUTA — guia de widgets (NÃO ligado a prompt)

> Promovida: o guia oficial agora é `docs/widget-guide.md` (o chat o lê). Esta minuta fica como histórico.

> Minuta para o dono decidir. Hoje nenhum prompt de `server/llm.ts` (escalada, linha ~179;
> chat, linha ~232) lê este arquivo. Ligar = acrescentar uma linha nesses prompts apontando
> para `docs/minuta-guia-widgets.md` (ou colar o texto). Texto de prompt é decisão do dono.

## Texto proposto

Ao escrever uma versão nova de widget (`widgets/<id>/v<n+1>.tsx`):

1. **Cor só por token semântico.** Use as classes `text-x-*`, `bg-x-*` e os tokens do kit
   (`bg-card`, `bg-muted`, `text-muted-foreground`, `border`). Em estilo inline, use apenas
   `var(--x-*)`, `var(--muted)` etc., ou `color-mix(in oklch, var(--x-…) N%, transparent)`.
   Nada de hex, `rgb()`, `oklch()` literal, `text-white`, `bg-black` nem paleta do Tailwind
   (`bg-red-500`). Cor crua (`--x-purple`, `--x-sky`…) só para série de gráfico sem
   significado; alerta/erro/sucesso usam `--x-alert`, `--x-error`, `--x-success`.
2. **Dois temas.** O app tem claro, escuro e automático (classe `.dark` no `<html>`). Todo
   widget precisa ficar legível nos dois; se usar `dark:`, use só para ajuste fino, nunca
   como única definição de uma cor.
3. **Mobile-first nos 4 tiers.** Conceba em 390 px e derive: tablet (`md:`, 768 px),
   desktop (`xl:`, 1280 px), TV (`tv:`, 1920 px). Sem rolagem horizontal da página: tabela,
   mapa de calor e gráfico largo vão dentro de `overflow-x-auto` próprio. Alvo de toque de
   44 px no celular (`size-11 md:size-9`). Caixa com rolagem interna usa `max-h-[60dvh]` no
   celular e `overscroll-contain`.
4. **Efeito com corpo em chaves.** `useEffect(() => { … })` — nunca devolver o valor de uma
   chamada (`scrollIntoView` devolve Promise no Chrome novo e o React a trata como cleanup:
   causou "destroy is not a function" no Chat v1).
5. **Reuso.** Peças de visualização vêm de `src/ui.tsx` (`Stat`, `Meter`, `StackedBars`,
   `Legend`, `RankList`) e componentes de `@atrium/core-ui`; ícones Phosphor.

# Guia de widgets

Guia oficial para escrever um widget do LLM Monitor que passa de primeira. Quem escreve
(o chat ou uma pessoa) segue este arquivo; o portão de publicação confere o resultado.

## 1. Contrato

- Um arquivo `.tsx` com `export default` de um componente **sem props**.
- Os dados vêm de `useSnapshot()` (import de `src/sdk`), que devolve o `Snapshot` vivo ou `null`
  antes da primeira leitura. Comece com `if (!s) return null;`.
- O widget não busca dados por conta própria: o snapshot chega por SSE e o componente reage a ele.
- Imports usam o caminho relativo de `widgets/<id>/v<n>.tsx`: `../../src/sdk`, `../../src/ui`,
  `@atrium/core-ui`, `@phosphor-icons/react`, `framer-motion`, `react`.
- Um widget é uma função pura do snapshot: sem `localStorage`, sem `fetch`, sem timers que escrevem no servidor.

## 2. Publicar

1. Escreva o rascunho em `state/agent-work/drafts/<id>.tsx`.
2. Publique pela API local (`http://127.0.0.1:4780/llm-monitor/api/v1`):
   - widget novo: `POST /widgets` com `{ id, title, description, size: { w, h }, file }`;
   - widget existente: `POST /widgets/<id>/versions/from-file` com `{ file, note }`.
3. `file` é o caminho do rascunho e precisa ficar dentro de `state/agent-work/drafts/`.
4. O portão roda o typecheck e, depois, um render de teste no navegador. A resposta traz
   `status`: `active` (aprovado, HTTP 201), `failed` (reprovado, HTTP 422, com `error` para corrigir)
   ou `testing` (HTTP 202: o typecheck passou e falta um navegador com o monitor aberto; a versão
   entra sozinha quando ele responder). O servidor espera o render de teste por até 30 s.
5. Reprovado na criação: o widget some da coleção e o `id` volta a ficar livre. Corrija o rascunho e publique de novo.
6. Versão publicada é imutável. Toda mudança é uma versão nova, inclusive correção de detalhe.
   Editar `v<n>.tsx` no lugar levanta o aviso "versão ativa editada no lugar".
7. O widget aprovado fica na **coleção**; o dono o posiciona nas páginas pelo modo editar.

Exemplo de corpo (`state/agent-work/drafts/gasto-hoje.json`):

```json
{ "id": "gasto-hoje", "title": "Gasto de hoje", "description": "Custo de hoje e o ritmo da última hora.", "size": { "w": 1, "h": 1 }, "file": "state/agent-work/drafts/gasto-hoje.tsx" }
```

```bash
curl -s -X POST http://127.0.0.1:4780/llm-monitor/api/v1/widgets -H "content-type: application/json" -d @state/agent-work/drafts/gasto-hoje.json
```

`id` é kebab-case (letras minúsculas, números e hífens, até 40 caracteres) e ainda não existe.
`size.w` vai de 1 a 3 e `size.h` de 1 a 4.

## 3. Tamanho: o widget vive numa célula de grade

- A página é uma grade; cada widget ocupa **w colunas × h linhas** (w 1–3, h 1–4). A célula é
  quadrada, com cerca de 320–400 px de lado; um widget `w:2 h:1` tem cerca de 680 × 340 px.
- O card do widget é um **container**: adapte o conteúdo por container query do próprio card
  (`@xs:`, `@sm:`, `@md:`, `@lg:`, `@xl:` do Tailwind) e não pela largura da janela.
  `@sm:` começa em 384 px, `@md:` em 448 px, `@lg:` em 512 px, `@xl:` em 576 px.
- O conteúdo **rola por dentro** (`overflow-y-auto`) quando passa da altura da célula; a página nunca ganha rolagem por causa dele.
- Escolha `size` pelo conteúdo: um número com legenda cabe em `1×1`; uma lista de até 5 linhas pede `1×2`;
  uma série temporal pede `2×1` ou `3×1`; tabela ou mapa de calor pede `2×2` ou mais.
  O dono pode mudar o tamanho depois, então o widget funciona bem em qualquer célula perto do `size` escolhido.

## 4. Dados: o que o snapshot oferece

`useSnapshot()` devolve `Snapshot` (definido em `shared/snapshot.ts`). Campos úteis:

| Campo | O que traz |
|---|---|
| `at` | Instante do snapshot (ISO). |
| `today`, `week` | `Bucket` do dia e da semana: `cost` (US$ equivalente), `total` (tokens), `input`, `output`, `cacheRead`, `cacheWrite`, `thinking`, `n` (respostas). |
| `bySource` | Consumo por origem (Claude Code, Soul…), lista de `Named` (`key` + `Bucket`). |
| `byModel`, `byModelWeek` | Consumo por modelo, hoje e na semana. |
| `byProject`, `byProjectToday` | Consumo por projeto, na semana e hoje. |
| `byAccount` | Consumo por conta. |
| `hourly` | Série por hora: `{ hour, cost, total, byModel }`. |
| `daily` | Série por dia: `{ day, cost, total }`. |
| `heatmap` | Matriz `[dia da semana 0=dom][hora]` com o custo médio dos últimos 28 dias. |
| `windows` | Janelas de 5 h: `{ start, end, cost, total, active }`. |
| `verdict` | Veredito do plano: `state`, `headline`, `short` e `windows` (5h, 7d, fable-7d com `usedPct`, `resetsAt`, `resetHuman`, `hitsHuman`, `projAtReset`). |
| `limits` | Leitura bruta dos limites: `state` (`ok` / `stale` / `missing`), `fiveHour` e `sevenDay` com `usedPct`. |
| `autonomy` | Quanto tempo o ritmo atual aguenta: `verdict` em texto e a base do cálculo. |
| `semana` | Ciclo semanal: `usedPct`, `needPerDay`, `todayPct`, `cost`, `lastWeekCost`, `byFamily`, `byProject`, `windows` (com `slack`), `points` (% por hora). |
| `cabe` | Dados do "Cabe?": presets de rodada e custo por ponto percentual. |
| `sidechainToday` | Parte do gasto de hoje que veio de subagentes: `cost`, `share`, `opusShare`. |
| `settings`, `catalog`, `tempDefault` | Modelo e esforço padrão do Claude Code, modelos disponíveis e troca temporária em vigor. |
| `soul` | Pools de contas Soul com contas, conta ativa e estado. |
| `flags`, `suggestions` | Avisos de anomalia e sugestões do pulso. |
| `pulse` | Estado do pulso (modelo, última e próxima execução). |
| `platform` | Gasto de hoje da plataforma, orçamento e chamadas. |
| `account`, `collector` | Conta do Claude Code e saúde do coletor. |

Formatadores prontos em `src/sdk`: `usd(n, digits?)`, `tokens(n)`, `pct(fração)`, `hhmm(iso)`, `ago(iso)`,
`modelName(id)`, `modelColor(...)`. Use-os em vez de formatar à mão: o monitor fala pt-BR.

## 5. Peças reusáveis

De `src/ui.tsx` (importe `../../src/ui`):

- `Stat({ label, value, hint?, tone? })`: número grande com legenda; `tone` é `alert | error | success | warning`.
- `Meter({ value, label, sub? })`: medidor de 0 a 100 com faixa por intenção (calmo, alerta, erro).
- `StackedBars({ data, keys, color, label, format, height? })`: barras empilhadas de série temporal.
- `Legend({ items })`: legenda de cores.
- `RankList({ rows, color })`: lista com barra proporcional.

De `@atrium/core-ui`: `Badge` (`tone`: `info`, `success`…), `Button`, `Empty` (+ `EmptyHeader`, `EmptyTitle`,
`EmptyDescription`), `ToggleGroup`, `Alert`, `Spinner`, `Markdown`, `Field`, `Input`. Ícones: `@phosphor-icons/react`.

## 6. Cor, tema e tiers

1. **Cor só por token semântico.** Use as classes `text-x-*`, `bg-x-*` e os tokens do kit
   (`bg-card`, `bg-muted`, `text-muted-foreground`, `border`). Em estilo inline, use apenas
   `var(--x-*)`, `var(--muted)` etc., ou `color-mix(in oklch, var(--x-…) N%, transparent)`.
   Escreva a cor pela intenção: alerta, erro e sucesso usam `--x-alert`, `--x-error`, `--x-success`.
   Cor crua (`--x-purple`, `--x-sky`…) fica para série de gráfico sem significado.
2. **Dois temas.** O app tem claro, escuro e automático (classe `.dark` no `<html>`). Todo widget fica
   legível nos dois; `dark:` serve para ajuste fino e nunca é a única definição de uma cor.
3. **Tiers.** Conceba para o celular (390 px) e derive: tablet (`md:`, 768 px), desktop (`xl:`, 1280 px),
   TV (`tv:`, 1920 px). Dentro do card, o ajuste fino vem das container queries da seção 3.
4. **Sem rolagem horizontal da página.** Tabela, mapa de calor e gráfico largo ficam dentro de um
   `overflow-x-auto` próprio. Alvo de toque de 44 px no celular (`size-11 md:size-9`).
5. **Efeito com corpo em chaves.** Escreva `useEffect(() => { … })` e deixe o corpo sem `return` de valor:
   `scrollIntoView` devolve Promise no Chrome novo e o React a trata como cleanup
   ("destroy is not a function" no Chat v1).
6. **Estados vazios têm texto.** Sem dados, mostre uma frase em português (`<p className="text-sm text-muted-foreground">…</p>`
   ou `Empty`), nunca um espaço em branco.
7. **Texto da tela em português**, curto, com números formatados pelos formatadores de `src/sdk`.

## 7. Exemplo mínimo completo

`state/agent-work/drafts/gasto-hoje.tsx`:

```tsx
// Gasto de hoje: custo do dia e quanto do plano de 5 h já foi.
import { Meter, Stat } from "../../src/ui";
import { tokens, usd, useSnapshot } from "../../src/sdk";

export default function GastoHoje() {
  const s = useSnapshot();
  if (!s) return null;
  const w5 = s.verdict.windows.find((w) => w.id === "5h");
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <Stat label="Hoje" value={usd(s.today.cost)} hint={`${tokens(s.today.total)} tokens em ${s.today.n} respostas`} />
      {w5?.usedPct != null ? (
        <Meter value={w5.usedPct} label="Janela de 5 h" sub={w5.resetHuman} />
      ) : (
        <p className="text-sm text-muted-foreground">Sem leitura da janela de 5 h agora.</p>
      )}
    </div>
  );
}
```

Esse widget usa `size: { w: 1, h: 1 }`: um número, um medidor e uma legenda cabem numa célula.

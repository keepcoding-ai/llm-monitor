# LLM Monitor

Plataforma local que monitora e administra o consumo de LLM do Claude Code e das contas
Soul mapeadas, para o dono nunca ficar sem LLM. React (Vite) + Hono, tudo em disco nesta
pasta (`state/`).

## Rodar

```bash
cd /d/atrium/workspace/guga/llm-monitor
npm install
npm run dev
```

Abra `http://127.0.0.1:4781/llm-monitor/`. API em `http://127.0.0.1:4780/llm-monitor/api/v1`.
A primeira subida lê todo o histórico de `~/.claude/projects` (≈4 GB levou ~46 s); depois
cada ciclo lê só o que cresceu (< 1 s).

## Ativar a statusline (limites de 5 h e semana)

Os limites do plano só existem no JSON que o Claude Code entrega à statusline. Sem ela o
painel diz "limites indisponíveis" e a autonomia mostra só tendência — nunca inventa número.
Para ativar, acrescente em `~/.claude/settings.json` (o app NÃO faz isso por você):

```json
"statusLine": {
  "type": "command",
  "command": "node D:/atrium/workspace/guga/llm-monitor/statusline.mjs"
}
```

O script grava `state/statusline.json` + `state/statusline-history.jsonl` (só modelo,
versão e `rate_limits`; nada de segredo) e imprime `Opus · 5h 42% · sem 10%`.

## Arquitetura — três camadas

**Camada 0 — coletor determinístico (sem LLM)**, a cada 15 s (`state/config.json`):
- Claude Code: `~/.claude/projects/**/*.jsonl` (inclui `subagents/`), offset por arquivo em
  `state/collector/offsets.json`, dedupe por `message.id`, sidechain marcado. Conta ativa só
  pelo e-mail/nome de `~/.claude.json`. O jsonl não grava conta: histórico anterior ao
  monitor fica "anterior ao monitor"; o que chega depois é atribuído à conta ativa.
- Soul: pools mapeáveis (default `~/.soul`). Contas, fila e saúde **só** via
  `@codrstudio/provider-pool` (o segredo nunca passa pelo app). Consumo em
  `<raiz>/.soul/profiles/<perfil>/sessions/<sessão>/usage.jsonl` (+ pastas extras por pool).
  O registro do motor não diz qual conta serviu o turno: o consumo é do pool.
- Série única em `state/collector/series.jsonl`; preço em `state/prices.json` (custo
  "equivalente API"); derivados em `state/derived.json`; anomalias em `state/flags.json`
  (campo desconhecido no jsonl, versão nova do Claude Code, salto de ritmo, fonte que falhou,
  modelo sem preço). UI atualizada por SSE (`/events`), sem polling.

**Camada 1 — pulso** (`server/llm.ts`): de hora em hora (configurável) roda
`claude -p --model haiku` sobre um resumo agregado + marcas (nunca dado bruto) e pede
`{ok, findings[], escalate}`. Histórico em `state/memory/pulses.jsonl`. Botão "Pulsar agora".

**Camada 2 — escalada**: `sonnet`/`opus` com leitura do código do app grava proposta em
`state/proposals/` (nunca aplica sozinha; uma proposta de widget pode entrar pelo fluxo de
troca). Fable nunca roda automático — fica registrado como "pede liberação". Escalada
automática vem desligada (`pulse.autoEscalate`); o botão "Escalar" fica nas sugestões.
Teto diário de gasto da plataforma em `platformDailyBudgetUSD`; as chamadas da plataforma
rodam em `state/agent-work/` e são separadas pelo `cwd` gravado nos jsonl.

**Chat**: `claude -p` (haiku, stream-json com mensagens parciais) com resumo + leitura de
`state/` e do código; histórico em `state/chat/`.

**Controle**: modelo/effort padrão do Claude Code gravados em `~/.claude/settings.json` só
pelo botão "Aplicar" (leitura-modifica-escrita, resto do arquivo intacto, backup em
`state/backups/`). Conta ativa do Soul via `activate()` do provider-pool.

## Plataforma viva

`state/layout.json` define os slots; cada widget é `widgets/<id>/v<n>.tsx`, carregado por
import dinâmico servido pelo próprio Vite — mesmo grafo de dependências do app (uma React,
um framer-motion, um core-ui), sem bundle paralelo. Versões são imutáveis.

Troca: `POST /llm-monitor/api/v1/widgets/<id>/versions {code, note}` → grava `v<n+1>` →
typecheck (tsc) → render de teste num harness oculto do navegador (ErrorBoundary) → só então
o slot muda, com entrada animada e selo "versão n". Cada slot tem ErrorBoundary próprio;
o painel "Versões" (`#versoes/<widget>`) desfaz a última troca ou põe no ar uma guardada.

Rotas: `/llm-monitor/` (painel) e `/llm-monitor/w/<slot>` (widget em foco).

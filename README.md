# LLM Monitor

Plataforma local que monitora e administra o consumo de LLM do Claude Code e das contas
Soul mapeadas, para o dono nunca ficar sem LLM. React (Vite) + Hono, tudo em disco nesta
pasta (`state/`).

## Rodar

### Uso diário: modo servido (leve, um processo)

```bash
cd /d/atrium/workspace/llm-monitor
npm install
npm run build   # front (vite build -> dist/) + server (esbuild -> dist-server/index.mjs)
npm start       # node do bundle; o próprio Hono serve a UI e a API na porta 4780
```

**O monitor abre em `http://localhost:4780/llm-monitor/`** (UI e API na mesma porta; API em
`/llm-monitor/api/v1`). Não há processo Vite nem tsx em runtime. `npm start` roda `node --max-old-space-size=96 --max-semi-space-size=1 dist-server/index.mjs`
(um único processo, ~130 MB de working set no Windows; o node vazio já gasta ~68 MB).
Refaça `npm run build` depois de mexer em `src/` ou `server/`; widgets novos do chat dispensam build
(o server compila cada versão sob demanda, ver `server/widget-serve.ts`).

### Memória (modo servido)

O server mantém em memória só a **janela quente** da série: 35 dias (`RETENTION_MS` em
`server/series.ts`; o derive nunca olha além de ~31). `state/collector/series.jsonl` segue completo em
disco e é lido em fluxo no boot; o painel mostra o total do disco. Registros com mais de 8 dias ficam
enxutos (só ts, fonte, modelo, plataforma, tokens e custo — o que os agregados de 28/30 dias leem). O
dedupe usa hash de 53 bits do id. O histórico da statusline é lido de forma incremental, só os últimos
8 dias. Mexeu em `derive.ts` e vai ler outro campo de registro velho? Amplie `slim()` em `series.ts`.

### Desenvolvimento (hot reload do front)

```bash
npm run dev
```

Abra `http://127.0.0.1:4781/llm-monitor/` (Vite). API em `http://127.0.0.1:4780/llm-monitor/api/v1`.
O `dev` roda server via tsx + Vite (~600 MB): é só para desenvolver. Se existir `dist/`, o server
do `dev` também serve a UI em 4780, mas o dia a dia é o `npm start`.

Variáveis: `LLM_MONITOR_PORT` (porta, padrão 4780) e `LLM_MONITOR_STATE` (pasta de estado
alternativa — use-a em instâncias de teste para não dividir o `series.jsonl` com a instância real).

A primeira subida lê todo o histórico de `~/.claude/projects` (≈4 GB levou ~46 s). Depois, a
cada ciclo só são examinados os arquivos mexidos nas últimas 24 h, e só os que cresceram são
lidos. A varredura completa se repete a cada 5 min: uma sessão nova pode levar até 5 min para
aparecer.

## Ativar a statusline (limites de 5 h e semana)

Os limites do plano só existem no JSON que o Claude Code entrega à statusline. Sem ela o
painel diz "limites indisponíveis" e a autonomia mostra só tendência — nunca inventa número.
Para ativar, acrescente em `~/.claude/settings.json` (o app NÃO faz isso por você):

```json
"statusLine": {
  "type": "command",
  "command": "node D:/atrium/workspace/llm-monitor/statusline.mjs"
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

**Chat**: roda o Claude Code com poder total na máquina (sem restrição de permissão), com resumo
+ leitura de `state/` e do código; histórico em `state/chat/`. Modelo e esforço escolhíveis na
tela; passos de ferramenta aparecem na conversa; parar mata a árvore de processos pelo PID.
Config no bloco `chat` de `state/config.json` (valores padrão do schema em `server/store.ts`):

- `model`: modelo do chat (padrão `haiku`).
- `effort`: esforço do chat; sem valor, não é passado ao `claude`.
- `bypassPermissions`: `true` passa `--dangerously-skip-permissions` (padrão `true`).
- `dirs`: pastas extras liberadas com `--add-dir` (padrão `D:/atrium`).
- `timeoutMin`: tempo limite de uma resposta, em minutos (padrão `60`).
- `ignoreBudget`: `true` tira o chat do teto diário (padrão `true`). Pulso e escalada seguem com o teto `platformDailyBudgetUSD`.

O chat cria e versiona widgets conforme `docs/widget-guide.md`: rascunho em
`state/agent-work/drafts/`, publicação pela API (ver "Plataforma viva"), passando pelo mesmo
portão (typecheck + render de teste, que precisa do monitor aberto num navegador).

**Reinício**: `POST /system/restart` marca o reinício; o server executa quando o chat fica
ocioso. Ele se substitui por um processo destacado (log em `state/restart.log`), então funciona
seja qual for o lançador (terminal, app desktop).

**Controle**: modelo/effort padrão do Claude Code gravados em `~/.claude/settings.json` só
pelo botão "Aplicar" (leitura-modifica-escrita, resto do arquivo intacto, backup em
`state/backups/`). Conta ativa do Soul via `activate()` do provider-pool.

## Plataforma viva

`state/layout.json` define os slots; cada widget é `widgets/<id>/v<n>.tsx`, carregado por
import dinâmico servido pelo próprio Vite — mesmo grafo de dependências do app (uma React,
um framer-motion, um core-ui), sem bundle paralelo. Versões são imutáveis.

Troca: a versão nova grava `v<n+1>` → typecheck (tsc) → render de teste num harness oculto do
navegador (ErrorBoundary) → só então o slot muda, com entrada animada e selo "versão n". Cada
slot tem ErrorBoundary próprio. Versões são imutáveis.

A montagem é por página. `state/layout.json` está na rev 6: `pages` (id, title, icon, order,
kind `grid`/`single`/`settings`, menu, fixed) e `slots` (widget, version, page, order, w 1–3,
h 1–8). A coleção de widgets é derivada de `widgets/<id>/manifest.json` a cada leitura; widget
sem manifest não aparece. Toda migração faz backup antes em
`state/backups/layout-rev<n>-<timestamp>.json`. A da rev 5 para a 6 só dobra o `h` de cada slot
(a linha passou a valer meia altura); páginas, slots e ordem ficam como estão.

Páginas `grid` são grades em 1, 2 ou 3 colunas conforme a largura do container (`src/grid.tsx`).
A linha vale meia coluna: `h: 2` é um quadrado, `h: 1` é uma faixa baixa. O widget ocupa w colunas
× h linhas, conhece a largura e a altura que recebeu e se adapta a elas (ver `docs/widget-guide.md`);
só lista longa rola por dentro. Veredito e
"Cabe?" são peças de código (builtin, `src/builtins.ts`), posicionáveis como qualquer widget.

Montagem na tela: "Editar página" permite arrastar, mudar largura e altura, mover para outra
página, remover e adicionar da coleção (`src/collection.tsx`, hash `#colecao`). Em Ajustes, a
seção "Menu" cria, renomeia, troca ícone, reordena e apaga páginas (`src/pages-admin.tsx`).
Arrastar usa `@dnd-kit`.

API (prefixo `/llm-monitor/api/v1`):

- `GET /layout` e `GET /collection`: layout completo e coleção de widgets.
- `POST /pages` cria página; `PATCH /pages/:id` troca título, ícone ou menu; `DELETE /pages/:id` apaga (páginas fixas não).
- `PUT /pages/order` reordena as páginas do menu.
- `POST /pages/:id/slots` adiciona widget da coleção à página; `PUT /pages/:id/slots/order` reordena os slots.
- `PATCH /slots/:id` muda tamanho, página ou título; `DELETE /slots/:id` remove o slot.
- `POST /widgets` cria widget novo a partir de rascunho (`id`, `title`, `description`, `size`, `file`); responde 201 aprovado, 202 pendente do render de teste, 422 reprovado.
- `POST /widgets/:id/versions/from-file` publica nova versão de um widget existente (`file`, `note`), com o mesmo portão.
- `POST /widgets/:id/versions` (`code`, `note`) propõe versão enviando o código no corpo.
- `POST /system/restart` pede o reinício (ver "Chat").

Rotas de tela: `/llm-monitor/<pageId>` (ex.: `/llm-monitor/` é a página `agora`), com
`/llm-monitor/semana` redirecionando para `/llm-monitor/ciclo`. `#versoes/<widget>` abre o
painel de versões, que desfaz a última troca ou põe no ar uma guardada.

## Comando llm-monitor

Atalho global para subir, consultar e parar o app de qualquer pasta do Git Bash
(`llm-monitor`, `llm-monitor status`, `llm-monitor stop`, `llm-monitor help`).
O script vive em `bin/llm-monitor`; em máquina nova, instale só o wrapper em `~/.bash-bin` (pasta que só o Git Bash enxerga; um `llm-monitor` sem extensão em pasta do PATH do Windows rouba o Win+R):

```bash
mkdir -p ~/.bash-bin
```
```bash
printf '#!/usr/bin/env bash\nexec /d/atrium/workspace/llm-monitor/bin/llm-monitor "$@"\n' > ~/.bash-bin/llm-monitor
```
```bash
chmod +x ~/.bash-bin/llm-monitor
```

Acrescente `~/.bash-bin` ao PATH do Git Bash (`~/.bashrc`):

```bash
echo 'export PATH="$HOME/.bash-bin:$PATH"' >> ~/.bashrc
```

## Windows (Win+R e login)

`Win+R` e `llm-monitor` sobem o app oculto (se preciso) e abrem o navegador; no login do Windows
ele sobe sozinho, oculto, sem abrir o navegador. Só HKCU, sem admin, idempotente. No PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\atrium\workspace\llm-monitor\bin\install-windows.ps1
```

Cria a chave `App Paths\llm-monitor.exe` (aponta para `bin\llm-monitor.vbs`) e o atalho
`LLM Monitor.lnk` em `shell:startup`. Não deixe um arquivo `llm-monitor` em pasta do PATH do Windows.

## Desktop (Tauri v2)

App de janela que, ao abrir, garante o server e mostra a UI. Fica em `src-tauri/`.

```bash
npm run tauri:dev     # janela em modo dev (compila o Rust em debug)
npm run tauri:build   # gera src-tauri/target/release/llm-monitor-desktop.exe e o instalador NSIS em bundle/nsis/
```

Como funciona:

- **A UI vem do Vite** (`http://127.0.0.1:4781/llm-monitor/`, o modo `npm run dev`); o app desktop ainda não usa o modo servido (`http://localhost:4780/llm-monitor/`).
- **Ao abrir**, checa a API (`4780`, `GET /llm-monitor/api/v1/auto-analysis`) e o front (`4781`). O que já responde é reusado; o que falta é iniciado com `node` + `tsx`/`vite` a partir do checkout, sem console (CREATE_NO_WINDOW). Uma tela de carregando fica até API, front e proxy do front responderem.
- **Ao fechar**, encerra só a árvore dos PIDs que ela mesma iniciou (`taskkill /PID <pid> /T /F`). Server que já estava rodando antes continua de pé.
- Logs dos filhos: `%TEMP%\llm-monitor-desktop-server.log` e `%TEMP%\llm-monitor-desktop-web.log`.

Variáveis:

| Variável | Padrão | Uso |
|---|---|---|
| `LLM_MONITOR_DIR` | pasta do repo onde o app foi buildado | checkout do llm-monitor (precisa de `node_modules`) |
| `LLM_MONITOR_NODE` | `node` (do PATH) | executável do Node |
| `LLM_MONITOR_PORT` / `LLM_MONITOR_WEB_PORT` | `4780` / `4781` | portas da API e do front |

O ícone vem de `public/icons/icon-512.png` (derivado de `brand/llm-monitor`): `npx tauri icon public/icons/icon-512.png -o src-tauri/icons`.
O crate só gera `rlib` (sem `cdylib`): no toolchain GNU do Windows o `cdylib` estoura o limite de ordinais do `ld`.

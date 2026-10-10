// Camadas 1 e 2: o pulso (haiku), a escalada (sonnet/opus) e o chat.
// Tudo via `claude -p`, rodando em state/agent-work para o coletor reconhecer
// o gasto da própria plataforma pelo cwd gravado nos jsonl.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_WORK, APP_ROOT, P, STATE, appendJsonl, expandHome, loadConfig, readJson, readJsonl, writeJson, type Config } from "./store.ts";
import { killTree } from "./process.ts";
import { maybeRestart } from "./system.ts";
import { initialParserState, reduceChatEvent } from "./chat-steps.ts";
import type { ChatStep } from "../shared/chat.ts";
import { buildSnapshot, setPulseState } from "./derive.ts";
import { publish } from "./bus.ts";
import type { PulseRecord, Snapshot } from "../shared/snapshot.ts";

type RunResult = { ok: boolean; text: string; costUSD: number | null; sessionId?: string; error?: string; timedOut?: boolean };

function claudeBin(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/** Gasto da plataforma hoje: o que o coletor viu nos jsonl (fonte da verdade)
 *  somado às chamadas recentes ainda não coletadas, pelo total_cost_usd. */
function platformSpentToday(snap: Snapshot): number {
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const logged = readJsonl<{ at: string; costUSD: number | null }>(P.platformSpend)
    .filter((x) => Date.parse(x.at) >= today0.getTime())
    .reduce((s, x) => s + (x.costUSD ?? 0), 0);
  return Math.max(snap.platform.todayCost, logged);
}

export function budgetGuard(): string | null {
  const snap = buildSnapshot();
  const spent = platformSpentToday(snap);
  if (spent >= snap.platform.budget) return `Teto diário da plataforma atingido (US$ ${spent.toFixed(2).replace(".", ",")} de US$ ${snap.platform.budget.toFixed(2).replace(".", ",")}). Aumente o teto em Ajustes → Plataforma ou espere amanhã.`;
  return null;
}

function runClaude(args: string[], prompt: string, onEvent?: (ev: any) => void, timeoutMs = 240_000, onSpawn?: (kill: () => void) => void): Promise<RunResult> {
  mkdirSync(AGENT_WORK, { recursive: true });
  return new Promise((resolve) => {
    // detached fora do Windows: o filho vira líder de grupo e killTree mata o grupo todo
    const child = spawn(claudeBin(), ["-p", ...args], { cwd: AGENT_WORK, env: { ...process.env }, windowsHide: true, detached: process.platform !== "win32" });
    let timedOut = false;
    const kill = () => void killTree(child.pid ?? 0);
    let out = "";
    let err = "";
    let buf = "";
    let result: RunResult = { ok: false, text: "", costUSD: null };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    onSpawn?.(kill);
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      if (!onEvent) return;
      buf += s;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* linha não-JSON */
        }
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, text: "", costUSD: null, error: `não foi possível iniciar o claude: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const lines = out.trim().split("\n");
        const last = JSON.parse(lines[lines.length - 1]);
        if (last.type === "result") {
          result = { ok: !last.is_error && code === 0, text: String(last.result ?? ""), costUSD: typeof last.total_cost_usd === "number" ? last.total_cost_usd : null, sessionId: last.session_id, error: last.is_error ? String(last.result ?? "erro") : undefined };
        } else result = { ok: false, text: out, costUSD: null, error: `saída inesperada (código ${code})` };
      } catch {
        result = { ok: false, text: out, costUSD: null, error: (err || out || `claude saiu com código ${code}`).slice(0, 800) };
      }
      if (timedOut) result = { ...result, ok: false, timedOut: true, error: `Tempo limite atingido (${Math.round(timeoutMs / 60_000)} min); a execução foi encerrada.` };
      appendJsonl(P.platformSpend, [{ at: new Date().toISOString(), costUSD: result.costUSD, args: args.filter((a) => !a.startsWith("{")).slice(0, 6) }]);
      resolve(result);
    });
    child.stdin.end(prompt);
  });
}

// ------------------------------------------------------------ resumo pequeno

/** O pulso nunca recebe dado bruto: só derivados agregados + marcas. */
export function compactSummary(s: Snapshot) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    agora: s.at,
    hoje: { custoUSD: r(s.today.cost), tokens: s.today.total, respostas: s.today.n },
    semana: { custoUSD: r(s.week.cost), tokens: s.week.total },
    porModeloHoje: s.byModel.slice(0, 6).map((m) => ({ modelo: m.key, custoUSD: r(m.cost), tokens: m.total })),
    porProjetoSemana: s.byProject.slice(0, 6).map((m) => ({ projeto: m.key, custoUSD: r(m.cost) })),
    subagentesHoje: { parcela: r(s.sidechainToday.share), opusEmSubagentes: r(s.sidechainToday.opusShare) },
    ultimas12h: s.hourly.slice(-12).map((h) => r(h.cost)),
    limites: s.limits,
    veredito: { estado: s.verdict.state, frase: s.verdict.headline, janelas: s.verdict.windows.map((w) => ({ janela: w.label, usado: w.usedPct, renova: w.resetHuman, esgota: w.exhausts ? w.hitsHuman : null })) },
    janelaAtual: s.windows.find((w) => w.active) ?? null,
    contasSoul: s.soul.map((p) => ({ pool: p.label, ok: p.ok, erro: p.error, contas: p.accounts.map((a) => ({ nome: a.label, ativa: a.isActive, estado: a.state, resetaEm: a.resetsAt })) })),
    marcas: s.flags.filter((f) => !f.ack).slice(0, 12).map((f) => ({ tipo: f.kind, nivel: f.level, titulo: f.title })),
    plataforma: { gastoHojeUSD: r(s.platform.todayCost), tetoUSD: s.platform.budget },
    modeloPadraoClaudeCode: s.settings,
  };
}

// ------------------------------------------------------------ pulso

let pulseRunning = false;

export async function pulse(trigger: "agenda" | "manual"): Promise<PulseRecord> {
  if (pulseRunning) throw new Error("já existe um pulso em andamento");
  const blocked = budgetGuard();
  const cfg = loadConfig();
  const at = new Date().toISOString();
  if (blocked) {
    const rec: PulseRecord = { at, model: cfg.pulse.model, ok: false, findings: [], escalate: "none", costUSD: null, error: blocked };
    appendJsonl(P.pulses, [rec]);
    setPulseState({ last: rec });
    return rec;
  }
  pulseRunning = true;
  setPulseState({ running: true });
  publish("pulse", { running: true });
  try {
    const snap = buildSnapshot();
    const memory = readJsonl<PulseRecord>(P.pulses).slice(-5).map((p) => ({ at: p.at, achados: p.findings, escalada: p.escalate }));
    const prompt = [
      "Você é o pulso horário do LLM Monitor, a plataforma que cuida para o dono nunca ficar sem LLM (Claude Code e contas Soul).",
      "Leia o resumo e as marcas abaixo e devolva SOMENTE um objeto JSON, sem texto antes ou depois, no formato:",
      '{"ok": boolean, "findings": string[], "escalate": "none"|"sonnet"|"opus"}',
      "- ok=false quando algo pede atenção do dono agora (limite perto, conta quebrada, salto de gasto, formato novo nos dados).",
      "- findings: até 4 frases curtas em português, concretas, com número; nada genérico.",
      "- escalate: 'opus' só se houver mudança de formato/campo novo que exija revisar o código do coletor; 'sonnet' para análise de custo mais funda; senão 'none'.",
      "",
      `Disparo: ${trigger}.`,
      "Resumo atual:",
      JSON.stringify(compactSummary(snap)),
      "",
      "Pulsos anteriores (memória):",
      JSON.stringify(memory),
    ].join("\n");
    const res = await runClaude(["--model", cfg.pulse.model, "--output-format", "json", "--tools", ""], prompt);
    let rec: PulseRecord;
    if (!res.ok) rec = { at, model: cfg.pulse.model, ok: false, findings: [], escalate: "none", costUSD: res.costUSD, error: res.error ?? "falha sem mensagem" };
    else {
      const m = res.text.match(/\{[\s\S]*\}/);
      try {
        const j = JSON.parse(m ? m[0] : res.text);
        rec = { at, model: cfg.pulse.model, ok: Boolean(j.ok), findings: Array.isArray(j.findings) ? j.findings.map(String).slice(0, 6) : [], escalate: ["sonnet", "opus", "fable"].includes(j.escalate) ? j.escalate : "none", costUSD: res.costUSD };
      } catch {
        rec = { at, model: cfg.pulse.model, ok: false, findings: [], escalate: "none", costUSD: res.costUSD, error: `o pulso não devolveu JSON: ${res.text.slice(0, 300)}` };
      }
    }
    if (rec.escalate === "fable") rec.escalation = { model: "fable", status: "pede liberação do Guga", note: "Fable nunca roda automático." };
    else if (rec.escalate !== "none") {
      if (cfg.pulse.autoEscalate) rec.escalation = await escalate(rec);
      else rec.escalation = { model: rec.escalate, status: "aguardando", note: "Escalada automática desligada; use o botão Escalar nas sugestões." };
    }
    appendJsonl(P.pulses, [rec]);
    setPulseState({ last: rec });
    return rec;
  } finally {
    pulseRunning = false;
    setPulseState({ running: false });
    publish("pulse", { running: false });
  }
}

/** Escalada: o modelo maior lê o achado e o código do app (só leitura) e
 *  produz uma proposta em state/proposals — nunca aplica sozinho. */
export async function escalate(rec: PulseRecord): Promise<NonNullable<PulseRecord["escalation"]>> {
  const model = rec.escalate === "opus" ? "opus" : "sonnet";
  const blocked = budgetGuard();
  if (blocked) return { model, status: "bloqueada", note: blocked };
  const prompt = [
    "Você é a camada de escalada do LLM Monitor. O pulso horário levantou os achados abaixo.",
    `Código do app: ${APP_ROOT} (servidor em server/, widgets em widgets/<id>/v<n>.tsx). Estado: ${STATE}.`,
    "Investigue (somente leitura) e devolva SOMENTE um JSON:",
    '{"title": string, "rationale": string, "action": "none"|"config"|"widget"|"collector", "patch": string|null, "widget": {"id": string, "code": string}|null}',
    "patch = diff unificado proposto (ou null). widget = código completo de uma nova versão de widget, se a correção for de interface.",
    "",
    "Achados:",
    JSON.stringify(rec.findings),
  ].join("\n");
  const res = await runClaude(["--model", model, "--output-format", "json", "--tools", "Read,Grep,Glob", "--add-dir", APP_ROOT], prompt, undefined, 600_000);
  if (!res.ok) return { model, status: "falhou", note: res.error };
  mkdirSync(P.proposals, { recursive: true });
  const file = join(P.proposals, `${new Date().toISOString().replace(/[:.]/g, "-")}-${model}.json`);
  const m = res.text.match(/\{[\s\S]*\}/);
  let body: unknown = res.text;
  try {
    body = JSON.parse(m ? m[0] : res.text);
  } catch {
    /* guarda o texto cru */
  }
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), model, findings: rec.findings, costUSD: res.costUSD, proposal: body }, null, 2));
  publish("proposals", { changed: true });
  return { model, status: "proposta gravada", proposal: file.split(/[\\/]/).pop() };
}

// ------------------------------------------------------------ chat

export type ChatMsg = { id: string; role: "user" | "assistant"; text: string; at: string; costUSD?: number | null; error?: string; attachments?: ChatAttachment[]; steps?: ChatStep[] };
export type ChatAttachment = { name: string; type: string; file: string };
export type ChatUpload = { name: string; type: string; data: string };
let chatBusy = false;
let stopChat: (() => void) | null = null;
let chatStopped = false;

export const isChatBusy = () => chatBusy;

/** Botão "parar" do chat: encerra a resposta em andamento; o que já chegou fica. */
export function stopChatRun(): boolean {
  if (!stopChat) return false;
  chatStopped = true;
  stopChat();
  return true;
}

export function chatHistory(): ChatMsg[] {
  return readJsonl<ChatMsg>(P.chat).slice(-200);
}

export const UPLOADS = join(AGENT_WORK, "uploads");
const MAX_UPLOAD = 8 * 1024 * 1024;

/** Anexos do chat: gravados em state/agent-work/uploads (cwd do agente) e lidos por ele com a
 *  ferramenta Read, que entende imagem e PDF. O nome no disco é gerado aqui, nunca o do cliente. */
function saveUploads(files: ChatUpload[] = []): ChatAttachment[] {
  mkdirSync(UPLOADS, { recursive: true });
  return files.slice(0, 6).map((f) => {
    const buf = Buffer.from(String(f.data ?? ""), "base64");
    if (!buf.length) throw new Error(`anexo vazio: ${f.name}`);
    if (buf.length > MAX_UPLOAD) throw new Error(`anexo grande demais (máx. 8 MB): ${f.name}`);
    const raw = String(f.name).match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? String(f.type).split("/")[1] ?? "bin";
    const ext = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || "bin";
    const file = `${crypto.randomUUID()}.${ext}`;
    writeFileSync(join(UPLOADS, file), buf);
    return { name: String(f.name).slice(0, 120), type: String(f.type).slice(0, 80), file };
  });
}

/** Chat pleno: sem lista de ferramentas e (por config) sem pedir permissão. cwd segue em state/agent-work. */
export function buildChatArgs(cfg: Config["chat"], system: string, sessionId?: string): string[] {
  const args = ["--model", cfg.model];
  if (cfg.effort) args.push("--effort", cfg.effort);
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  if (cfg.bypassPermissions) args.push("--dangerously-skip-permissions");
  const dirs = [...new Set([APP_ROOT, ...cfg.dirs.map(expandHome), UPLOADS])];
  for (const d of dirs) args.push("--add-dir", d);
  args.push("--append-system-prompt", system);
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

/** Bloco do system do chat sobre criar e mudar widgets (guia completo: docs/widget-guide.md). */
export function widgetPrompt(port = process.env.LLM_MONITOR_PORT || 4780): string[] {
  const api = `http://127.0.0.1:${port}/llm-monitor/api/v1`;
  const drafts = join(AGENT_WORK, "drafts");
  return [
    `Widgets e código: você tem acesso total a esta máquina e ao código do monitor (raiz do app: ${APP_ROOT}).`,
    `Para criar ou mudar um widget, leia ${join(APP_ROOT, "docs", "widget-guide.md")} e escreva o rascunho em ${drafts}/<id>.tsx. Publique com curl na API local (${api}):`,
    `- widget novo: POST ${api}/widgets com {"id","title","description","size":{"w","h"},"file"}.`,
    `- widget existente: POST ${api}/widgets/<id>/versions/from-file com {"file","note"}.`,
    `"file" é o caminho do rascunho, sempre dentro de ${drafts}. Grave o corpo da requisição num arquivo .json nessa mesma pasta e envie com: curl -s -X POST <url> -H "content-type: application/json" -d @${drafts}/<id>.json`,
    `Leia a resposta e corrija o rascunho até o status voltar "active". Resposta com status "failed" traz o erro do typecheck ou do render de teste; resposta com status "testing" espera um navegador com o monitor aberto, e você avisa o dono disso.`,
    `Versões publicadas ficam como estão: toda mudança vira versão nova. O widget aprovado fica na coleção; diga ao dono que ele o posiciona nas páginas pelo modo editar.`,
    `Depois de mudar arquivos em server/**, rode npm run typecheck em ${APP_ROOT} e faça POST ${api}/system/restart (o reinício espera sua resposta terminar). Mudanças em src/** recarregam sozinhas.`,
  ];
}

export async function chat(message: string, context?: string, uploads?: ChatUpload[]): Promise<void> {
  if (chatBusy) throw new Error("o chat ainda está respondendo");
  const attachments = saveUploads(uploads);
  const cfg = loadConfig();
  const blocked = cfg.chat.ignoreBudget ? null : budgetGuard();
  const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", text: message, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) };
  appendJsonl(P.chat, [userMsg]);
  publish("chat", { type: "message", message: userMsg });
  const id = crypto.randomUUID();
  if (blocked) {
    const m: ChatMsg = { id, role: "assistant", text: "", at: new Date().toISOString(), error: blocked };
    appendJsonl(P.chat, [m]);
    publish("chat", { type: "message", message: m });
    return;
  }
  chatBusy = true;
  const sess = readJson<{ sessionId?: string }>(P.chatSession, {});
  const system = [
    "Você é o chat do LLM Monitor: gestão de custo de LLM do dono (Claude Code e contas Soul) e evolução deste app.",
    "Responda em português, direto, com números. Você tem acesso total ao Claude Code desta máquina (arquivos, shell, rede): faça o que o dono pedir como faria no terminal.",
    `Estado do app (série normalizada, derivados, memória, flags): ${STATE}. Use ${P.derived} para o resumo completo; ${P.series} tem um registro por resposta (pesado: use Grep).`,
    `Código do app: ${APP_ROOT}. Widgets ficam em widgets/<id>/v<n>.tsx.`,
    ...widgetPrompt(),
    "Resumo atual:",
    JSON.stringify(compactSummary(buildSnapshot())),
    ...(context?.trim() ? [`Contexto da tela que o dono está vendo agora (use para entender a pergunta; não repita): ${context.trim()}`] : []),
  ].join("\n");
  const args = buildChatArgs(cfg.chat, system, sess.sessionId);
  publish("chat", { type: "start", id });
  let parser = initialParserState();
  chatStopped = false;
  try {
    const prompt = attachments.length ? `${message}\n\n[Anexos do dono; use a ferramenta Read para vê-los]\n${attachments.map((a) => `- ${a.name}: ${join(UPLOADS, a.file)}`).join("\n")}` : message;
    const res = await runClaude(args, prompt, (ev) => {
      const r = reduceChatEvent(parser, ev, id);
      parser = r.state;
      for (const e of r.emits) publish("chat", e);
    }, cfg.chat.timeoutMin * 60_000, (kill) => (stopChat = kill));
    const text = parser.text;
    const steps = parser.steps.length ? parser.steps : undefined;
    // Com passos, o texto é o acumulado de todos os turnos (result.result traz só o último).
    const finalText = res.ok ? (steps ? text || res.text : res.text || text) : text;
    if (res.sessionId) writeJson(P.chatSession, { sessionId: res.sessionId });
    const m: ChatMsg = chatStopped
      ? { id, role: "assistant", text: text ? `${text}

_(interrompida por você)_` : "", at: new Date().toISOString(), costUSD: res.costUSD, error: text ? undefined : "Resposta interrompida por você antes de começar." }
      : { id, role: "assistant", text: finalText, at: new Date().toISOString(), costUSD: res.costUSD, error: res.ok ? undefined : res.error };
    if (steps) m.steps = steps.map((s) => (s.status === "running" ? { ...s, status: "error" as const, output: s.output ?? "interrompido" } : s));
    appendJsonl(P.chat, [m]);
    publish("chat", { type: "message", message: m });
  } finally {
    chatBusy = false;
    stopChat = null;
    void maybeRestart();
  }
}

export function resetChat(): void {
  writeJson(P.chatSession, {});
  // não destrói: arquiva o histórico atual ao lado, com timestamp, e o visível recomeça vazio
  if (existsSync(P.chat)) renameSync(P.chat, P.chat.replace(/\.jsonl$/, "") + `.${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  publish("chat", { type: "reset" });
}

export function listProposals(): { file: string; at: string; model: string; title: string; rationale: string; hasWidget: boolean; costUSD: number | null }[] {
  if (!existsSync(P.proposals)) return [];
  return readdirSync(P.proposals)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((f) => {
      const j = JSON.parse(readFileSync(join(P.proposals, f), "utf8"));
      const p = typeof j.proposal === "object" && j.proposal ? j.proposal : {};
      return { file: f, at: j.at, model: j.model, title: p.title ?? "Proposta sem título", rationale: p.rationale ?? String(j.proposal).slice(0, 400), hasWidget: Boolean(p.widget?.code), costUSD: typeof j.costUSD === "number" ? j.costUSD : null };
    });
}

// Camadas 1 e 2: o pulso (haiku), a escalada (sonnet/opus) e o chat.
// Tudo via `claude -p`, rodando em state/agent-work para o coletor reconhecer
// o gasto da própria plataforma pelo cwd gravado nos jsonl.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_WORK, APP_ROOT, P, STATE, appendJsonl, loadConfig, readJson, readJsonl, writeJson } from "./store.ts";
import { buildSnapshot, setPulseState } from "./derive.ts";
import { publish } from "./bus.ts";
import type { PulseRecord, Snapshot } from "../shared/snapshot.ts";

type RunResult = { ok: boolean; text: string; costUSD: number | null; sessionId?: string; error?: string };

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
    const child = spawn(claudeBin(), ["-p", ...args], { cwd: AGENT_WORK, env: { ...process.env }, windowsHide: true });
    let out = "";
    let err = "";
    let buf = "";
    let result: RunResult = { ok: false, text: "", costUSD: null };
    const timer = setTimeout(() => child.kill(), timeoutMs);
    onSpawn?.(() => child.kill());
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

export type ChatMsg = { id: string; role: "user" | "assistant"; text: string; at: string; costUSD?: number | null; error?: string; attachments?: ChatAttachment[] };
export type ChatAttachment = { name: string; type: string; file: string };
export type ChatUpload = { name: string; type: string; data: string };
let chatBusy = false;
let stopChat: (() => void) | null = null;
let chatStopped = false;

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

export async function chat(message: string, context?: string, uploads?: ChatUpload[]): Promise<void> {
  if (chatBusy) throw new Error("o chat ainda está respondendo");
  const attachments = saveUploads(uploads);
  const blocked = budgetGuard();
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
  const cfg = loadConfig();
  const sess = readJson<{ sessionId?: string }>(P.chatSession, {});
  const system = [
    "Você é o chat do LLM Monitor: gestão de custo de LLM do dono (Claude Code e contas Soul) e evolução deste app.",
    "Responda em português, direto, com números. Use as ferramentas de leitura quando precisar de detalhe.",
    `Estado do app (série normalizada, derivados, memória, flags): ${STATE}. Use ${P.derived} para o resumo completo; ${P.series} tem um registro por resposta (pesado: use Grep).`,
    `Código do app: ${APP_ROOT}. Widgets ficam em widgets/<id>/v<n>.tsx; para propor um widget novo, mostre o código completo.`,
    "Resumo atual:",
    JSON.stringify(compactSummary(buildSnapshot())),
    ...(context?.trim() ? [`Contexto da tela que o dono está vendo agora (use para entender a pergunta; não repita): ${context.trim()}`] : []),
  ].join("\n");
  const args = ["--model", cfg.chatModel, "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--tools", "Read,Grep,Glob", "--add-dir", APP_ROOT, "--add-dir", UPLOADS, "--append-system-prompt", system];
  if (sess.sessionId) args.push("--resume", sess.sessionId);
  publish("chat", { type: "start", id });
  let text = "";
  chatStopped = false;
  try {
    const prompt = attachments.length ? `${message}\n\n[Anexos do dono; use a ferramenta Read para vê-los]\n${attachments.map((a) => `- ${a.name}: ${join(UPLOADS, a.file)}`).join("\n")}` : message;
    const res = await runClaude(args, prompt, (ev) => {
      if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
        text += ev.event.delta.text;
        publish("chat", { type: "delta", id, text: ev.event.delta.text });
      }
    }, undefined, (kill) => (stopChat = kill));
    if (res.sessionId) writeJson(P.chatSession, { sessionId: res.sessionId });
    const m: ChatMsg = chatStopped
      ? { id, role: "assistant", text: text ? `${text}

_(interrompida por você)_` : "", at: new Date().toISOString(), costUSD: res.costUSD, error: text ? undefined : "Resposta interrompida por você antes de começar." }
      : { id, role: "assistant", text: res.ok ? res.text || text : text, at: new Date().toISOString(), costUSD: res.costUSD, error: res.ok ? undefined : res.error };
    appendJsonl(P.chat, [m]);
    publish("chat", { type: "message", message: m });
  } finally {
    chatBusy = false;
    stopChat = null;
  }
}

export function resetChat(): void {
  writeJson(P.chatSession, {});
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

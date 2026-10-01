// LLM Monitor — backend Hono. Prefixo /llm-monitor (UI) e /llm-monitor/api/v1 (API).
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { APP_ROOT, P, appendJsonl, loadConfig, seedState, writeJson, readJson, readJsonl, type Config, type ModelsCatalog } from "./store.ts";
import { loadSeries, records } from "./series.ts";
import { collectClaude, meta } from "./collector/claude.ts";
import { collectSoul, activateSoulAccount } from "./collector/soul.ts";
import { saveOffsets } from "./collector/incremental.ts";
import { buildSnapshot, setPulseState, statuslineMtime } from "./derive.ts";
import { ackFlag, flushFlags } from "./flags.ts";
import { publish, subscribe } from "./bus.ts";
import { writeClaudeDefaults, settingsPath, readClaudeSettings } from "./control.ts";
import { chat, chatHistory, listProposals, pulse, resetChat, escalate, stopChatRun } from "./llm.ts";
import { loadLayout, pendingTestList, proposeWidget, reportTest, restoreWidget, undoWidget } from "./widgets.ts";
import type { Snapshot } from "../shared/snapshot.ts";

const PORT = Number(process.env.LLM_MONITOR_PORT || 4780);

seedState();
loadSeries();
loadLayout();

// ------------------------------------------------------------ ciclo da camada 0

let snapshot: Snapshot | null = null;
let collecting = false;
let collectorError: string | null = null;

async function cycle() {
  if (collecting) return;
  collecting = true;
  try {
    const a = await collectClaude((n) => publish("progress", { files: n, records: records.length }));
    const b = await collectSoul();
    revertTempDefault();
    saveOffsets();
    collectorError = null;
    snapshot = buildSnapshot();
    writeJson(P.derived, snapshot);
    flushFlags();
    publish("snapshot", snapshot);
    if (a + b > 0) console.log(`[coletor] +${a} claude-code, +${b} soul (total ${records.length}) em ${meta.lastCycleMs} ms`);
  } catch (e) {
    collectorError = (e as Error).stack ?? String(e);
    console.error("[coletor] falhou:", collectorError);
    publish("collector-error", { error: (e as Error).message });
  } finally {
    collecting = false;
  }
}

function scheduleCycle() {
  setTimeout(async () => {
    await cycle();
    scheduleCycle();
  }, loadConfig().collectIntervalSec * 1000);
}

// statusline grava em disco; reflete na hora sem esperar o ciclo
let slMtime = statuslineMtime();
setInterval(() => {
  const m = statuslineMtime();
  if (m !== slMtime) {
    slMtime = m;
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
  }
}, 2000);

// ------------------------------------------------------------ pulso agendado

let pulseTimer: NodeJS.Timeout | null = null;
function schedulePulse() {
  if (pulseTimer) clearTimeout(pulseTimer);
  const cfg = loadConfig();
  if (!cfg.pulse.enabled) {
    setPulseState({ nextAt: null });
    return;
  }
  const ms = cfg.pulse.everyMinutes * 60_000;
  setPulseState({ nextAt: new Date(Date.now() + ms).toISOString() });
  pulseTimer = setTimeout(async () => {
    try {
      await pulse("agenda");
    } catch (e) {
      console.error("[pulso]", (e as Error).message);
    }
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    schedulePulse();
  }, ms);
}

// ------------------------------------------------------------ API

const api: Hono = new Hono();

api.get("/snapshot", (c) => (snapshot ? c.json(snapshot) : c.json({ error: collectorError ?? "primeira coleta em andamento" }, 503)));

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const queue: { event: string; data: string }[] = [];
    let wake: (() => void) | null = null;
    const unsub = subscribe((e) => {
      queue.push({ event: e.event, data: JSON.stringify(e.data) });
      wake?.();
    });
    stream.onAbort(() => {
      unsub();
      wake?.();
    });
    if (snapshot) await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
    else await stream.writeSSE({ event: "progress", data: JSON.stringify({ files: 0, records: records.length }) });
    await stream.writeSSE({ event: "layout", data: JSON.stringify(loadLayout()) });
    for (const t of pendingTestList()) await stream.writeSSE({ event: "widget-test", data: JSON.stringify(t) });
    while (!stream.aborted) {
      if (queue.length === 0) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 25_000); // keep-alive
        });
        wake = null;
        if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
      }
      while (queue.length) {
        const e = queue.shift()!;
        await stream.writeSSE(e);
      }
    }
  }),
);

api.post("/flags/:key/ack", (c) => {
  const ok = ackFlag(decodeURIComponent(c.req.param("key")));
  flushFlags();
  snapshot = buildSnapshot();
  publish("snapshot", snapshot);
  return c.json({ ok });
});

// controle: modelo/effort padrão do Claude Code
api.post("/control/claude", async (c) => {
  const body = (await c.req.json()) as { model?: string | null; effortLevel?: string | null };
  try {
    const r = writeClaudeDefaults(body);
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    return c.json({ ok: true, ...r, target: settingsPath() === join(process.env.USERPROFILE ?? "", ".claude", "settings.json") ? "real" : "cópia de teste" });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});

// Alavanca do "Por quê hoje": troca o modelo padrão até a renovação da semana e
// volta sozinha (o clique do dono autoriza a ida e a volta). Desfazer devolve na hora.
api.post("/control/claude/temporary", async (c) => {
  const { model, until } = (await c.req.json()) as { model: string; until: string };
  if (!model || !until || !Number.isFinite(Date.parse(until))) return c.json({ ok: false, error: "modelo ou prazo inválido" }, 400);
  try {
    const previous = (readClaudeSettings().model as string | undefined) ?? null;
    const r = writeClaudeDefaults({ model });
    writeJson(P.tempDefault, { model, previous, until, at: new Date().toISOString() });
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    return c.json({ ok: true, previous, backup: r.backup });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});
api.post("/control/claude/temporary/undo", (c) => {
  const t = readJson<{ previous: string | null } | null>(P.tempDefault, null);
  if (!t) return c.json({ ok: false, error: "não há troca temporária para desfazer" }, 400);
  try {
    writeClaudeDefaults({ model: t.previous });
    rmSync(P.tempDefault, { force: true });
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});
function revertTempDefault() {
  const t = readJson<{ previous: string | null; until: string } | null>(P.tempDefault, null);
  if (!t || Date.now() < Date.parse(t.until)) return;
  writeClaudeDefaults({ model: t.previous });
  rmSync(P.tempDefault, { force: true });
  console.log(`[controle] modelo padrão voltou para ${t.previous ?? "o padrão do plano"} (fim da troca temporária)`);
}

// controle: conta ativa do Soul (via provider-pool)
api.post("/control/soul/activate", async (c) => {
  const { dir, accountId } = (await c.req.json()) as { dir: string; accountId: string };
  try {
    activateSoulAccount(dir, accountId);
    await collectSoul();
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }
});

api.get("/config", (c) => c.json({ config: loadConfig(), models: readJson<ModelsCatalog>(P.models, { claude: { models: [], efforts: [] } }) }));
api.put("/config", async (c) => {
  const body = (await c.req.json()) as Partial<Config>;
  const cur = loadConfig();
  const next: Config = { ...cur, ...body, pulse: { ...cur.pulse, ...(body.pulse ?? {}) } };
  if (!Array.isArray(next.soulPools) || next.soulPools.some((p) => !p.dir)) return c.json({ ok: false, error: "lista de pools inválida" }, 400);
  writeJson(P.config, next);
  schedulePulse();
  void cycle();
  return c.json({ ok: true, config: next });
});

api.post("/pulse", async (c) => {
  try {
    const rec = await pulse("manual");
    snapshot = buildSnapshot();
    publish("snapshot", snapshot);
    return c.json(rec);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 409);
  }
});

api.post("/pulse/escalate", async (c) => {
  const last = buildSnapshot().pulse.last;
  if (!last || last.escalate === "none" || last.escalate === "fable") return c.json({ error: "o último pulso não pediu escalada executável" }, 400);
  const r = await escalate(last);
  return c.json(r);
});

// Cabe?: registra a estimativa para conferir depois de uma janela (previsão vs real)
api.post("/cabe/estimate", async (c) => {
  const { preset, usd } = (await c.req.json()) as { preset: string; usd: number };
  if (!snapshot || !Number.isFinite(usd)) return c.json({ error: "sem dados para estimar" }, 409);
  const w7 = snapshot.verdict.windows.find((w) => w.id === "7d");
  const sl = readJson<{ session?: string }>(P.statusline, {});
  appendJsonl(P.cabeEstimates, [{ at: new Date().toISOString(), preset, usd, usdPerPctWeek: snapshot.cabe.usdPerPctWeek, session: sl.session ?? null, weekResetsAt: w7?.resetsAt ?? null }]);
  return c.json({ ok: true });
});
// Fable no /usage: registro manual do % oficial (a linha de status não traz limite por modelo). Expira na renovação semanal.
api.post("/fable-manual", async (c) => {
  const { pct } = (await c.req.json()) as { pct: number | null };
  if (pct == null) {
    rmSync(P.fableManual, { force: true });
  } else {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return c.json({ ok: false, error: "informe um número de 0 a 100" }, 400);
    const w7 = snapshot?.verdict.windows.find((w) => w.id === "7d");
    writeJson(P.fableManual, { pct, at: new Date().toISOString(), resetsAt: w7?.resetsAt ?? null });
  }
  snapshot = buildSnapshot();
  publish("snapshot", snapshot);
  return c.json({ ok: true });
});
api.get("/pulses", (c) => c.json(readJsonl(P.pulses).slice(-40)));
api.get("/proposals", (c) => c.json(listProposals()));
api.post("/proposals/:file/apply-widget", async (c) => {
  const f = c.req.param("file");
  if (!/^[\w.-]+\.json$/.test(f)) return c.json({ error: "arquivo inválido" }, 400);
  const j = JSON.parse(readFileSync(join(P.proposals, f), "utf8"));
  const w = j.proposal?.widget;
  if (!w?.id || !w?.code) return c.json({ error: "proposta sem widget" }, 400);
  return c.json(await proposeWidget(w.id, w.code, j.proposal.title ?? "proposta", j.model));
});

api.get("/chat", (c) => c.json(chatHistory()));
api.post("/chat", async (c) => {
  // `context` (tela atual) entra no system do chat (texto aprovado em docs/minuta-chat-contexto.md).
  const { message, context } = (await c.req.json()) as { message: string; context?: string };
  if (!message?.trim()) return c.json({ error: "mensagem vazia" }, 400);
  chat(message.trim(), context).catch((e) => publish("chat", { type: "error", error: (e as Error).message }));
  return c.json({ accepted: true }, 202);
});
api.post("/chat/stop", (c) => c.json({ stopped: stopChatRun() }));
// Ajustes → Linha de status → "como ativar": o único lugar da UI que mostra o comando (dono é dev)
api.get("/setup/statusline", (c) => c.json({ snippet: JSON.stringify({ statusLine: { type: "command", command: `node ${join(APP_ROOT, "statusline.mjs").split("\\").join("/")}` } }, null, 2) }));
api.post("/chat/reset", (c) => {
  resetChat();
  return c.json({ ok: true });
});

// plataforma viva
api.get("/layout", (c) => c.json(loadLayout()));
api.post("/widgets/:id/versions", async (c) => {
  const { code, note } = (await c.req.json()) as { code: string; note?: string };
  try {
    return c.json(await proposeWidget(c.req.param("id"), code, note ?? "", "api"));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
api.get("/widgets/:id/versions/:v/source", (c) => {
  const id = c.req.param("id");
  const v = Number(c.req.param("v"));
  const f = join(P.layout, "..", "..", "widgets", id, `v${v}.tsx`);
  if (!/^[a-z0-9-]+$/.test(id) || !existsSync(f)) return c.json({ error: "não encontrado" }, 404);
  return c.text(readFileSync(f, "utf8"));
});
api.post("/widgets/:id/versions/:v/test", async (c) => {
  const { ok, error } = (await c.req.json()) as { ok: boolean; error?: string };
  return c.json(reportTest(c.req.param("id"), Number(c.req.param("v")), ok, error));
});
api.post("/widgets/:id/undo", (c) => {
  try {
    return c.json({ v: undoWidget(c.req.param("id")) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
api.post("/widgets/:id/restore/:v", (c) => {
  try {
    restoreWidget(c.req.param("id"), Number(c.req.param("v")));
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

const app: Hono = new Hono();
app.route("/llm-monitor/api/v1", api);
app.get("/", (c) => c.redirect("/llm-monitor/"));

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`[llm-monitor] API em http://127.0.0.1:${PORT}/llm-monitor/api/v1 (pid ${process.pid})`);
  void cycle().then(scheduleCycle);
  schedulePulse();
});

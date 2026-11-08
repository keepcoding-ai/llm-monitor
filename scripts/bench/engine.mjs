// Deterministic per-operation token attribution for Claude Code transcripts.
// Pure logic (no I/O): feed it parsed transcript lines, then call finalize().
// Pricing and dedupe mirror server/series.ts + server/collector/claude.ts:
//   - price row = first table row where model.startsWith(row.match)
//   - cost = (input*in + output*out + (cw-cw1h)*cw5m + cw1h*cw1h + cr*cr) / 1e6
//   - one usage record per message.id (first line wins); "<synthetic>" skipped
// PRIVACY: never keeps message text, tool inputs or tool output. Only sizes,
// ids, tool names and a sanitized hint (bash first word / read basename).
import { createHash } from "node:crypto";

// ---- thresholds (named constants) -------------------------------------------
export const CHARS_PER_TOKEN = 4;
export const IMAGE_BLOCK_CHARS = 6000; // an image block ~1500 tokens
export const COMPACT_DROP_RATIO = 0.5; // ctx falls below 50% of previous turn
export const COMPACT_MIN_PREV_CTX = 20_000;
export const CACHE_TTL_MS = 5 * 60_000;
export const CACHE_TTL_1H_MS = 60 * 60_000;
export const IDLE_REBUILD_MIN_WRITE = 10_000; // cacheWrite tokens
export const IDLE_REBUILD_MIN_CTX_SHARE = 0.5; // write >= 50% of the turn context
export const FINDING_BIG_RESULT_TOKENS = 10_000;
export const FINDING_BIG_RESULT_COST_SHARE = 0.1; // carry of big results / total cost
export const FINDING_CTX_NO_COMPACT_TOKENS = 200_000;
export const FINDING_IDLE_MIN_COUNT = 3;
export const FINDING_IDLE_COST_SHARE = 0.03;
export const FINDING_BIG_READ_TOKENS = 8_000; // whole-file Read above this
export const FINDING_BIG_READ_MIN_COUNT = 3;
export const FINDING_REPEAT_READ_MIN = 3; // same Read >= N times inside one context segment
export const FINDING_BASH_BIG_TOKENS = 5_000;
export const FINDING_BASH_BIG_MIN_COUNT = 5;
export const FINDING_CACHE_READ_COST_SHARE = 0.5;
export const FINDING_SIDECHAIN_COST_SHARE = 0.3;
export const FINDING_SUBAGENT_RATIO_USD_PER_KTOK = 2; // sync subagents only // sidechain $ per 1k result tokens

export function priceFor(table, model) {
  return table.models.find((m) => model.startsWith(m.match)) ?? null;
}
export function costParts(p, u) {
  const input = (u.input * p.input) / 1e6;
  const output = (u.output * p.output) / 1e6;
  const cacheWrite = ((u.cacheWrite - u.cacheWrite1h) * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h) / 1e6;
  const cacheRead = (u.cacheRead * p.cacheRead) / 1e6;
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}

export function toolGroup(name) {
  if (name.startsWith("mcp__")) return "mcp:" + (name.split("__")[1] || "?");
  return name;
}
const safeWord = (s, max = 40) => String(s ?? "").replace(/[^\w.\-/]/g, "").slice(0, max);
const SECRETISH = /(\.env|secret|token|credential|passw|\.pem|\.key|id_rsa|\.p12|\.pfx)/i;

function describe(name, input) {
  // never returns more than: bash first word, read basename, skill/agent type
  if (!input || typeof input !== "object") return { hint: "", key: "" };
  if (name === "Bash") {
    const cmd = String(input.command ?? "").replace(/^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)+/, ""); // skip leading "cd <dir> &&"
    const m = /^\s*([A-Za-z0-9_.\/-]{1,24})(=?)/.exec(cmd);
    return { hint: !m ? "" : m[2] ? "(var-assign)" : m[1], key: "" };
  }
  if (name === "Read") {
    const fp = String(input.file_path ?? "");
    const base = fp.split(/[\\/]/).pop() || "";
    const ext = /\.([A-Za-z0-9]{1,8})$/.exec(base)?.[1] ?? "";
    const hint = SECRETISH.test(base) ? `*.${ext || "?"} (nome omitido)` : safeWord(base, 60);
    const whole = input.offset == null && input.limit == null;
    const key = createHash("sha1").update(fp + "|" + input.offset + "|" + input.limit).digest("hex").slice(0, 12);
    return { hint, key, whole, ext };
  }
  if (name === "Agent" || name === "Task") return { hint: safeWord(input.subagent_type, 40) };
  if (name === "Skill") return { hint: safeWord(input.skill, 40) };
  return { hint: "", key: "" };
}

function measure(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") n += b.text.length;
    else if (b.type === "image") n += IMAGE_BLOCK_CHARS;
  }
  return n;
}

export function projectLabel(cwd) {
  if (!cwd) return "?";
  return cwd.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

export function createAnalyzer({ prices, sinceMs = 0 }) {
  const seen = new Map(); // message.id -> turn | null (skipped)
  const ctxs = new Map(); // key -> context
  const toolIndex = new Map(); // tool_use_id -> call
  let unpricedTokens = 0;

  function ctxFor(j, file) {
    const session = j.sessionId || file.session || "?";
    const agentId = j.agentId || file.agentId || "";
    const side = Boolean(j.isSidechain) || file.side;
    const key = session + (side ? ":" + (agentId || "side") : "");
    let c = ctxs.get(key);
    if (!c) {
      c = { key, session, agentId: side ? agentId : "", side, project: projectLabel(j.cwd), turns: [] };
      ctxs.set(key, c);
    }
    return c;
  }

  function addCalls(turn, content) {
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b?.type !== "tool_use" || toolIndex.has(b.id)) continue;
      const d = describe(b.name, b.input);
      const call = { id: b.id, name: b.name, group: toolGroup(b.name), hint: d.hint, key: d.key, whole: d.whole, chars: null, agentId: "", turn };
      turn.calls.push(call);
      toolIndex.set(b.id, call);
    }
  }

  function ingest(j, file = {}) {
    if (!j || typeof j !== "object") return;
    if (j.type === "assistant" && j.message?.usage) {
      const m = j.message;
      const id = m.id ?? j.uuid;
      if (seen.has(id)) {
        const t = seen.get(id);
        if (t) addCalls(t, m.content);
        return;
      }
      const model = m.model ?? "?";
      const ts = Date.parse(j.timestamp ?? "") || 0;
      if (model === "<synthetic>" || ts < sinceMs) { seen.set(id, null); return; }
      const u = m.usage;
      const rec = {
        input: Number(u.input_tokens ?? 0),
        output: Number(u.output_tokens ?? 0),
        cacheWrite: Number(u.cache_creation_input_tokens ?? 0),
        cacheWrite1h: Number(u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
        cacheRead: Number(u.cache_read_input_tokens ?? 0),
        thinking: Number(u.output_tokens_details?.thinking_tokens ?? 0),
      };
      const p = priceFor(prices, model);
      const parts = p ? costParts(p, rec) : null;
      if (!p) unpricedTokens += rec.input + rec.output + rec.cacheWrite + rec.cacheRead;
      const c = ctxFor(j, file);
      const turn = { ts, model, ...rec, ctx: rec.input + rec.cacheRead + rec.cacheWrite, cost: parts, price: p, calls: [], boundary: false, idle: null };
      c.turns.push(turn);
      seen.set(id, turn);
      addCalls(turn, m.content);
    } else if (j.type === "user" && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) {
        if (b?.type !== "tool_result") continue;
        const call = toolIndex.get(b.tool_use_id);
        if (!call) continue;
        call.chars = measure(b.content);
        const aid = j.toolUseResult?.agentId;
        if (typeof aid === "string") call.agentId = safeWord(aid, 40);
        if (j.toolUseResult?.isAsync) call.async = true;
      }
    }
  }

  function finalize() {
    const sessions = new Map();
    const tools = new Map();
    const models = new Map();
    const allCalls = [];
    const idleRebuilds = [];
    const sideCostByAgent = new Map();
    const zero = () => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, turns: 0, cost: 0, costInput: 0, costOutput: 0, costCacheWrite: 0, costCacheRead: 0 });
    const add = (a, t) => {
      a.input += t.input; a.output += t.output; a.cacheWrite += t.cacheWrite; a.cacheRead += t.cacheRead; a.thinking += t.thinking; a.turns += 1;
      if (t.cost) { a.cost += t.cost.total; a.costInput += t.cost.input; a.costOutput += t.cost.output; a.costCacheWrite += t.cost.cacheWrite; a.costCacheRead += t.cost.cacheRead; }
    };
    const totals = zero();

    for (const c of ctxs.values()) {
      const T = c.turns;
      const n = T.length;
      if (!n) continue;
      let s = sessions.get(c.session);
      if (!s) {
        s = { session: c.session, project: c.project, all: zero(), main: zero(), side: zero(), firstTs: Infinity, lastTs: 0, mainTurns: 0, sideTurns: 0, peakCtx: 0, peakCtxSide: 0, compactions: 0, idle: { count: 0, gross: 0, excess: 0 }, models: new Set() };
        sessions.set(c.session, s);
      }
      if (!c.side) s.project = c.project;
      // boundaries (compaction/clear) and idle rebuilds
      const wPrice = (t) => (t.price ? ((t.cacheWrite - t.cacheWrite1h) * t.price.cacheWrite5m + t.cacheWrite1h * t.price.cacheWrite1h) / 1e6 : 0);
      for (let i = 0; i < n; i++) {
        const t = T[i];
        if (i > 0) {
          const pv = T[i - 1];
          if (pv.ctx >= COMPACT_MIN_PREV_CTX && t.ctx < pv.ctx * COMPACT_DROP_RATIO) { t.boundary = true; s.compactions++; }
          const ttl = pv.cacheWrite1h > 0 ? CACHE_TTL_1H_MS : CACHE_TTL_MS;
          if (!t.boundary && t.ts - pv.ts > ttl && t.cacheWrite >= IDLE_REBUILD_MIN_WRITE && t.cacheWrite >= IDLE_REBUILD_MIN_CTX_SHARE * t.ctx) {
            const gross = wPrice(t);
            const excess = t.price ? gross - (t.cacheWrite * t.price.cacheRead) / 1e6 : 0;
            t.idle = { gap: t.ts - pv.ts, gross, excess };
            s.idle.count++; s.idle.gross += gross; s.idle.excess += excess;
            idleRebuilds.push({ session: c.session, side: c.side, gapMin: (t.ts - pv.ts) / 60000, tokens: t.cacheWrite, gross, excess });
          }
        }
        add(totals, t); add(s.all, t); add(c.side ? s.side : s.main, t);
        let mm = models.get(t.model); if (!mm) models.set(t.model, (mm = zero())); add(mm, t);
        s.models.add(t.model);
        s.firstTs = Math.min(s.firstTs, t.ts); s.lastTs = Math.max(s.lastTs, t.ts);
        if (c.side) { s.sideTurns++; s.peakCtxSide = Math.max(s.peakCtxSide, t.ctx); } else { s.mainTurns++; s.peakCtx = Math.max(s.peakCtx, t.ctx); }
      }
      if (c.side && c.agentId) {
        const a = sideCostByAgent.get(c.agentId) ?? { cost: 0, turns: 0, session: c.session };
        for (const t of T) { a.cost += t.cost?.total ?? 0; a.turns++; }
        sideCostByAgent.set(c.agentId, a);
      }
      // carry: suffix over turns inside the same context segment
      // segEnd[i] = first boundary index > i (or n): the context segment ends there
      const segEnd = new Array(n);
      let end = n;
      for (let i = n - 1; i >= 0; i--) { segEnd[i] = end; if (T[i].boundary) end = i; }
      const pre = new Array(n + 1).fill(0); // prefix of cacheRead price per token ($/tok)
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (T[i].price ? T[i].price.cacheRead / 1e6 : 0);
      const readsSeen = new Map(); // key@segment -> count
      for (let i = 0; i < n; i++) {
        for (const call of T[i].calls) {
          const tokens = call.chars == null ? null : call.chars / CHARS_PER_TOKEN;
          let carry = 0, carried = 0;
          const e = segEnd[i];
          if (tokens && i + 1 < e) {
            const nx = T[i + 1];
            carried = e - 1 - i;
            carry = tokens * ((nx.price ? nx.price.cacheWrite5m / 1e6 : 0) + (pre[e] - pre[i + 2]));
          }
          let repeat = false;
          if (call.name === "Read" && call.key) {
            const k = call.key + "@" + e;
            const cnt = (readsSeen.get(k) ?? 0) + 1;
            readsSeen.set(k, cnt);
            repeat = cnt > 1;
          }
          const rec = { session: c.session, side: c.side, ctxKey: c.key, name: call.name, group: call.group, hint: call.hint, tokens, carry, carried, whole: Boolean(call.whole), repeat, agentId: call.agentId, async: Boolean(call.async), id: call.id };
          allCalls.push(rec);
          let ts = tools.get(call.group);
          if (!ts) tools.set(call.group, (ts = { tool: call.group, calls: 0, withResult: 0, sizes: [], tokens: 0, carry: 0, carried: 0 }));
          ts.calls++;
          if (tokens != null) { ts.withResult++; ts.sizes.push(tokens); ts.tokens += tokens; }
          ts.carry += carry; ts.carried += carried;
        }
      }
    }

    const pct = (arr, q) => {
      if (!arr.length) return 0;
      const a = [...arr].sort((x, y) => x - y);
      return a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)];
    };
    const toolRows = [...tools.values()].map((t) => ({ tool: t.tool, calls: t.calls, withResult: t.withResult, avgTokens: t.withResult ? t.tokens / t.withResult : 0, p95Tokens: pct(t.sizes, 0.95), totalTokens: t.tokens, carryCost: t.carry, turnsCarried: t.carried })).sort((a, b) => b.carryCost - a.carryCost);

    const subagents = allCalls.filter((c) => c.name === "Agent" || c.name === "Task").map((c) => {
      const a = c.agentId ? sideCostByAgent.get(c.agentId) : null;
      return { session: c.session, type: c.hint, agentId: c.agentId, sidechainCost: a?.cost ?? null, sidechainTurns: a?.turns ?? null, resultTokens: c.tokens, carryCost: c.carry, async: c.async };
    });

    return { totals, models, sessions, toolRows, allCalls, idleRebuilds, subagents, unpricedTokens, ctxCount: ctxs.size };
  }

  return { ingest, finalize };
}

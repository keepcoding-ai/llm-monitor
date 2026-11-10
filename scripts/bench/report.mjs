// Turns the analyzer result into report.json + report.md (pt-BR). Aggregates only.
import * as E from "./engine.mjs";

const usd = (x) => "$" + (x ?? 0).toFixed(x >= 100 ? 0 : 2);
const num = (x) => Math.round(x ?? 0).toLocaleString("pt-BR");
const pctS = (x) => (x * 100).toFixed(1) + "%";
const dur = (ms) => (ms >= 3600e3 ? (ms / 3600e3).toFixed(1) + "h" : Math.round(ms / 60e3) + "min");
const short = (id) => String(id).slice(0, 8);

export function buildReport(res, { top = 10, since, project, session, generatedAt = new Date().toISOString() } = {}) {
  const { totals, models, sessions, toolRows, allCalls, idleRebuilds, subagents } = res;
  const totalCost = totals.cost || 1e-9;

  const sessRows = [...sessions.values()].map((s) => ({
    session: s.session, short: short(s.session), project: s.project, models: [...s.models],
    mainTurns: s.mainTurns, sideTurns: s.sideTurns, durationMs: s.lastTs - s.firstTs,
    tokens: { input: s.all.input, output: s.all.output, cacheWrite: s.all.cacheWrite, cacheRead: s.all.cacheRead, thinking: s.all.thinking },
    cost: s.all.cost,
    costShare: { input: s.all.costInput / (s.all.cost || 1), output: s.all.costOutput / (s.all.cost || 1), cacheWrite: s.all.costCacheWrite / (s.all.cost || 1), cacheRead: s.all.costCacheRead / (s.all.cost || 1) },
    mainCost: s.main.cost, sideCost: s.side.cost,
    peakCtx: s.peakCtx, peakCtxSide: s.peakCtxSide, compactions: s.compactions,
    idleRebuilds: s.idle.count, idleExcess: s.idle.excess, idleGross: s.idle.gross,
  })).sort((a, b) => b.cost - a.cost);

  const byType = {
    tokens: { input: totals.input, output: totals.output, cacheWrite: totals.cacheWrite, cacheRead: totals.cacheRead, thinking: totals.thinking },
    cost: { input: totals.costInput, output: totals.costOutput, cacheWrite: totals.costCacheWrite, cacheRead: totals.costCacheRead, total: totals.cost },
    costShare: { input: totals.costInput / totalCost, output: totals.costOutput / totalCost, cacheWrite: totals.costCacheWrite / totalCost, cacheRead: totals.costCacheRead / totalCost },
  };
  const allTok = totals.input + totals.output + totals.cacheWrite + totals.cacheRead || 1;
  byType.tokenShare = { input: totals.input / allTok, output: totals.output / allTok, cacheWrite: totals.cacheWrite / allTok, cacheRead: totals.cacheRead / allTok };
  const modelRows = [...models.entries()].map(([model, m]) => ({ model, turns: m.turns, input: m.input, output: m.output, cacheWrite: m.cacheWrite, cacheRead: m.cacheRead, thinking: m.thinking, cost: m.cost, cacheReadCostShare: m.cost ? m.costCacheRead / m.cost : 0 })).sort((a, b) => b.cost - a.cost);

  const topCalls = allCalls.filter((c) => c.carry > 0).sort((a, b) => b.carry - a.carry).slice(0, top).map((c) => ({
    tool: c.group, name: c.name, session: short(c.session), side: c.side, hint: c.hint, resultTokens: Math.round(c.tokens), turnsCarried: c.carried, estCost: c.carry,
  }));

  const totalCarry = allCalls.reduce((a, c) => a + c.carry, 0);
  const bigCarry = allCalls.filter((c) => (c.tokens ?? 0) >= E.FINDING_BIG_RESULT_TOKENS).reduce((a, c) => a + c.carry, 0);
  const idleTotal = idleRebuilds.reduce((a, r) => ({ count: a.count + 1, gross: a.gross + r.gross, excess: a.excess + r.excess }), { count: 0, gross: 0, excess: 0 });

  const subRows = subagents.map((s) => ({ ...s, session: short(s.session), ratio: s.sidechainCost != null && s.resultTokens && !s.async ? s.sidechainCost / (s.resultTokens / 1000) : null }));
  const subLinked = subRows.filter((s) => s.sidechainCost != null);
  const subSummary = {
    calls: subRows.length, linked: subLinked.length, async: subRows.filter((s) => s.async).length,
    sidechainCost: subLinked.reduce((a, s) => a + s.sidechainCost, 0),
    avgResultTokens: subRows.length ? subRows.reduce((a, s) => a + (s.resultTokens ?? 0), 0) / subRows.length : 0,
  };
  const topSub = [...subLinked].sort((a, b) => b.sidechainCost - a.sidechainCost).slice(0, top);

  // ---- findings ----
  const F = [];
  const sideShare = sessRows.reduce((a, s) => a + s.sideCost, 0) / totalCost;
  if (byType.costShare.cacheRead >= E.FINDING_CACHE_READ_COST_SHARE)
    F.push({ id: "cache-read-dominates", metric: `${pctS(byType.costShare.cacheRead)} do custo e ${pctS(byType.tokenShare.cacheRead)} dos tokens são cacheRead`, suggestion: "O custo cresce com (tamanho do contexto x número de turnos): encerre com /clear ou compacte antes de ~150k tokens e abra sessão nova ao trocar de assunto." });
  if (totalCarry > 0 && bigCarry / totalCost >= E.FINDING_BIG_RESULT_COST_SHARE)
    F.push({ id: "big-results-carry", metric: `resultados de ferramenta > ${num(E.FINDING_BIG_RESULT_TOKENS)} tokens carregam ~${usd(bigCarry)} estimados (${pctS(bigCarry / totalCost)} do custo)`, suggestion: "Limite a saída na origem: Bash com | head/grep/tail, Read com offset/limit, Grep com -n e glob estreito; delegue exploração pesada a um subagente barato." });
  const noCompact = sessRows.filter((s) => s.peakCtx > E.FINDING_CTX_NO_COMPACT_TOKENS && s.compactions === 0);
  if (noCompact.length)
    F.push({ id: "ctx-no-compaction", metric: `${noCompact.length} sessão(ões) passaram de ${num(E.FINDING_CTX_NO_COMPACT_TOKENS)} tokens de contexto sem compactar/limpar (ex.: ${noCompact.slice(0, 3).map((s) => `${s.short} pico ${num(s.peakCtx)}`).join("; ")})`, suggestion: `Rode /compact ou /clear ao chegar perto de ${num(E.FINDING_CTX_NO_COMPACT_TOKENS / 2)} tokens; cada turno extra relê o contexto inteiro.` });
  if (idleTotal.count >= E.FINDING_IDLE_MIN_COUNT && idleTotal.gross / totalCost >= E.FINDING_IDLE_COST_SHARE)
    F.push({ id: "idle-rebuilds", metric: `${idleTotal.count} reconstruções de cache após ociosidade > TTL, ${usd(idleTotal.gross)} em cacheWrite (${usd(idleTotal.excess)} a mais que manter quente)`, suggestion: "Evite pausas > 5 min no meio de uma tarefa longa (ou retome com sessão nova e contexto curto); tarefas lentas em segundo plano também estouram o TTL." });
  const bigReads = allCalls.filter((c) => c.name === "Read" && c.whole && (c.tokens ?? 0) >= E.FINDING_BIG_READ_TOKENS);
  if (bigReads.length >= E.FINDING_BIG_READ_MIN_COUNT)
    F.push({ id: "whole-file-reads", metric: `${bigReads.length} leituras de arquivo inteiro > ${num(E.FINDING_BIG_READ_TOKENS)} tokens (~${usd(bigReads.reduce((a, c) => a + c.carry, 0))} de carry)`, suggestion: "Use Grep para achar o trecho e Read com offset/limit; não leia o arquivo todo para mexer em uma função." });
  const repeats = allCalls.filter((c) => c.repeat);
  const repeatKeys = new Map();
  for (const c of repeats) repeatKeys.set(c.ctxKey + c.hint, (repeatKeys.get(c.ctxKey + c.hint) ?? 0) + 1);
  const heavyRepeat = [...repeatKeys.values()].filter((n) => n + 1 >= E.FINDING_REPEAT_READ_MIN).length;
  if (heavyRepeat)
    F.push({ id: "repeated-reads", metric: `${repeats.length} leituras idênticas repetidas no mesmo contexto (${heavyRepeat} arquivo(s) lidos ${E.FINDING_REPEAT_READ_MIN}+ vezes), ~${usd(repeats.reduce((a, c) => a + c.carry, 0))} de carry`, suggestion: "O arquivo já está no contexto: referencie o que leu em vez de reler; releia só trecho alterado (offset/limit)." });
  const bigBash = allCalls.filter((c) => c.name === "Bash" && (c.tokens ?? 0) >= E.FINDING_BASH_BIG_TOKENS);
  if (bigBash.length >= E.FINDING_BASH_BIG_MIN_COUNT) {
    const words = new Map();
    for (const c of bigBash) words.set(c.hint || "?", (words.get(c.hint || "?") ?? 0) + 1);
    const top3 = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w} x${n}`).join(", ");
    F.push({ id: "big-bash", metric: `${bigBash.length} chamadas Bash com saída > ${num(E.FINDING_BASH_BIG_TOKENS)} tokens (mais comuns: ${top3}), ~${usd(bigBash.reduce((a, c) => a + c.carry, 0))} de carry`, suggestion: "Filtre a saída no próprio comando (| head -50, | grep, --quiet, -q) e redirecione logs longos para arquivo." });
  }
  if (sideShare >= E.FINDING_SIDECHAIN_COST_SHARE)
    F.push({ id: "sidechain-share", metric: `${pctS(sideShare)} do custo vem de subagentes (sidechains)`, suggestion: "Confirme se os subagentes rodam em modelo barato (sonnet/haiku) e com prompt que peça resposta curta." });
  const expensiveSub = subLinked.filter((s) => s.ratio != null && s.ratio >= E.FINDING_SUBAGENT_RATIO_USD_PER_KTOK);
  if (expensiveSub.length)
    F.push({ id: "subagent-ratio", metric: `${expensiveSub.length} subagente(s) síncronos custaram ≥ ${usd(E.FINDING_SUBAGENT_RATIO_USD_PER_KTOK)} por 1k tokens devolvidos`, suggestion: "Subagente que gasta muito e devolve pouco: restrinja o escopo (arquivos/pastas), peça resumo curto, ou faça a busca direto com Grep." });
  if (res.unpricedTokens) F.push({ id: "unpriced", metric: `${num(res.unpricedTokens)} tokens de modelos sem preço em state/prices.json ficaram fora do custo`, suggestion: "Adicione a linha do modelo em state/prices.json." });

  return {
    generatedAt, params: { since, project, session, top },
    note: "Totais por sessão/tipo/modelo são exatos (mesma conta do coletor). Carry, tamanho de resultado (chars/4) e reconstruções de cache são ESTIMATIVAS.",
    totals: byType, models: modelRows, tools: toolRows, topCalls,
    sessions: sessRows, idle: { ...idleTotal, perSession: sessRows.filter((s) => s.idleRebuilds).map((s) => ({ session: s.short, count: s.idleRebuilds, excess: s.idleExcess, gross: s.idleGross })).sort((a, b) => b.gross - a.gross) },
    subagents: { summary: subSummary, top: topSub },
    carry: { total: totalCarry, bigResults: bigCarry },
    findings: F, unpricedTokens: res.unpricedTokens, contexts: res.ctxCount,
  };
}

export function renderMarkdown(r) {
  const L = [];
  const t = r.totals;
  L.push(`# Benchmark de tokens do Claude Code`, "", `Gerado em ${r.generatedAt} · janela: ${r.params.since ?? "?"}${r.params.project ? ` · projeto contém "${r.params.project}"` : ""}${r.params.session ? ` · sessão ${r.params.session}` : ""}`, "", `> ${r.note}`, "");
  L.push(`## Achados`, "");
  if (!r.findings.length) L.push("Nenhum limiar foi ultrapassado.", "");
  for (const f of r.findings) L.push(`- **${f.metric}.** Sugestão: ${f.suggestion}`);
  L.push("", `## 1. Totais por tipo de token (exato)`, "", `Custo total ${usd(t.cost.total)}.`, "", `| tipo | tokens | % tokens | custo | % custo |`, `|---|---:|---:|---:|---:|`);
  for (const k of ["input", "output", "cacheWrite", "cacheRead"]) L.push(`| ${k} | ${num(t.tokens[k])} | ${pctS(t.tokenShare[k])} | ${usd(t.cost[k])} | ${pctS(t.costShare[k])} |`);
  L.push(`| thinking (parte do output) | ${num(t.tokens.thinking)} | | | |`, "");
  L.push(`## 2. Por modelo (exato)`, "", `| modelo | turnos | cacheRead | cacheWrite | output | custo | % do custo em cacheRead |`, `|---|---:|---:|---:|---:|---:|---:|`);
  for (const m of r.models) L.push(`| ${m.model} | ${num(m.turns)} | ${num(m.cacheRead)} | ${num(m.cacheWrite)} | ${num(m.output)} | ${usd(m.cost)} | ${pctS(m.cacheReadCostShare)} |`);
  L.push("", `## 3. Sessões mais caras (exato)`, "", `| sessão | projeto | turnos (main+sub) | duração | custo | principal / subagentes | %in/%out/%cW/%cR | pico de contexto | compactações |`, `|---|---|---:|---:|---:|---|---|---:|---:|`);
  for (const s of r.sessions.slice(0, r.params.top)) L.push(`| ${s.short} | ${s.project} | ${s.mainTurns}+${s.sideTurns} | ${dur(s.durationMs)} | ${usd(s.cost)} | ${usd(s.mainCost)} / ${usd(s.sideCost)} | ${["input", "output", "cacheWrite", "cacheRead"].map((k) => Math.round(s.costShare[k] * 100)).join("/")} | ${num(s.peakCtx)} | ${s.compactions} |`);
  L.push("", `## 4. Ferramentas (ESTIMATIVA de carry)`, "", `Resultado ≈ chars/4. Carry = tokens do resultado x (cacheWrite uma vez + cacheRead x turnos seguintes no mesmo contexto, até compactação/clear). Carry total estimado: ${usd(r.carry.total)}.`, "", `| ferramenta | chamadas | tokens médios | p95 | turnos carregados | carry estimado |`, `|---|---:|---:|---:|---:|---:|`);
  for (const x of r.tools.slice(0, Math.max(r.params.top, 15))) L.push(`| ${x.tool} | ${num(x.calls)} | ${num(x.avgTokens)} | ${num(x.p95Tokens)} | ${num(x.turnsCarried)} | ${usd(x.carryCost)} |`);
  L.push("", `## 5. Chamadas individuais mais caras por carry (ESTIMATIVA)`, "", `| ferramenta | detalhe | sessão | tokens do resultado | turnos carregados | custo est. |`, `|---|---|---|---:|---:|---:|`);
  for (const c of r.topCalls) L.push(`| ${c.tool}${c.side ? " (sub)" : ""} | ${c.hint || "-"} | ${c.session} | ${num(c.resultTokens)} | ${c.turnsCarried} | ${usd(c.estCost)} |`);
  L.push("", `## 6. Reconstruções de cache após ociosidade (ESTIMATIVA)`, "", `${r.idle.count} reconstruções; ${usd(r.idle.gross)} em cacheWrite, dos quais ${usd(r.idle.excess)} a mais que ler do cache.`, "");
  if (r.idle.perSession.length) { L.push(`| sessão | reconstruções | cacheWrite | excesso |`, `|---|---:|---:|---:|`); for (const s of r.idle.perSession.slice(0, r.params.top)) L.push(`| ${s.session} | ${s.count} | ${usd(s.gross)} | ${usd(s.excess)} |`); }
  const ss = r.subagents.summary;
  L.push("", `## 7. Eficiência dos subagentes`, "", `${ss.calls} chamadas Agent/Task (${ss.linked} com sidechain na janela; ${ss.async} assíncronas/em segundo plano devolvem só um aviso de lançamento no tool_result, então o tamanho devolvido de fato não é mensurável e elas ficam fora da razão); custo das sidechains ${usd(ss.sidechainCost)}; resultado médio devolvido ${num(ss.avgResultTokens)} tokens.`, "", `| tipo | sessão | custo da sidechain | turnos | tokens devolvidos | US$ por 1k tokens devolvidos |`, `|---|---|---:|---:|---:|---:|`);
  for (const s of r.subagents.top) L.push(`| ${s.type || "-"} | ${s.session} | ${usd(s.sidechainCost)} | ${s.sidechainTurns} | ${num(s.resultTokens ?? 0)} | ${s.ratio != null ? usd(s.ratio) : "-"} |`);
  L.push("");
  return L.join("\n");
}

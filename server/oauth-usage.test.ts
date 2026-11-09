// Cache/TTL e backoff de 429 da leitura oficial. fetch e relógio são simulados; o token é falso e nunca impresso.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __resetOfficialUsage, getOfficialUsage, parseRetryAfter } from "./oauth-usage.ts";

const realFetch = globalThis.fetch;
const realNow = Date.now;
let calls = 0;
let clock = 1_800_000_000_000;
let mode: "ok" | "429" = "ok";
let retryAfter: string | null = "120";

beforeEach(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "tok-de-teste";
  __resetOfficialUsage();
  calls = 0; mode = "ok"; retryAfter = "120"; clock = 1_800_000_000_000;
  Date.now = () => clock;
  globalThis.fetch = (async () => {
    calls++;
    if (mode === "429") return new Response("", { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });
    return new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: null } }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; Date.now = realNow; });

test("TTL de 300 s é respeitado", async () => {
  await getOfficialUsage();
  clock += 299_000;
  await getOfficialUsage();
  assert.equal(calls, 1);
  clock += 2_000;
  await getOfficialUsage();
  assert.equal(calls, 2);
});

test("429 mantém o último bom valor e expõe backoffUntil", async () => {
  const first = await getOfficialUsage();
  assert.equal(first.state, "ok");
  mode = "429";
  clock += 301_000;
  const r = await getOfficialUsage();
  assert.equal(calls, 2);
  assert.equal(r.state, "ok");
  assert.equal(r.at, first.at);
  assert.equal(r.five?.usedPct, 42);
  assert.equal(r.backoffUntil, new Date(clock + 120_000).toISOString());
  // dentro do backoff e depois do TTL: nenhuma chamada nova
  clock += 119_000;
  await getOfficialUsage();
  assert.equal(calls, 2);
});

test("Retry-After: segundos, data HTTP e ausente (10 min)", () => {
  assert.equal(parseRetryAfter("30", 0), 30_000);
  assert.equal(parseRetryAfter(new Date(90_000).toUTCString(), 0), 90_000);
  assert.equal(parseRetryAfter(null), 600_000);
});

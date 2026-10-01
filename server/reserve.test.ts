import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../shared/reserve.ts";
import type { SoulAccount, SoulPool } from "../shared/snapshot.ts";

const acc = (id: string, p: Partial<SoulAccount> = {}): SoulAccount => ({ id, providerId: "anthropic", label: id, kind: "oauth", masked: "oauth", position: 1, isActive: false, state: "ok", ...p });
const pool = (accounts: SoulAccount[]): SoulPool => ({ dir: "~/.soul", label: "p", ok: true, accounts, order: accounts.map((a) => a.id), sessionFiles: 0 });

test("reserva: pool com 1 conta → só 1 conta", () => assert.equal(recommend(pool([acc("a", { isActive: true })])).kind, "single"));
test("reserva: 2+ contas → a ok (não ativa) de reset mais distante", () => {
  const r = recommend(pool([acc("ativa", { isActive: true }), acc("cedo", { resetsAt: "2026-10-02T10:00:00Z" }), acc("tarde", { resetsAt: "2026-10-05T10:00:00Z" }), acc("quota", { state: "quota" })]));
  assert.equal(r.kind === "account" && r.account.id, "tarde");
});
test("reserva: sem reset informado conta como a mais folgada; nenhuma ok → none", () => {
  assert.equal((recommend(pool([acc("x", { isActive: true }), acc("y", { resetsAt: "2026-10-05T10:00:00Z" }), acc("z")])) as any).account.id, "z");
  assert.equal(recommend(pool([acc("x", { isActive: true }), acc("q", { state: "auth" })])).kind, "none");
});

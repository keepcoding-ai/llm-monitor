import { test } from "node:test";
import assert from "node:assert/strict";
import { createPulseScheduler } from "./pulse-schedule.ts";

/** Relógio falso: guarda os timers e dispara na mão. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    pending,
    set: (fn: () => void, _ms: number) => (pending.set(++id, fn), id),
    clear: (t: unknown) => void pending.delete(t as number),
    async fireAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const f of fns) await f();
    },
  };
}

function setup(enabled: boolean) {
  const cfg = { enabled, everyMinutes: 60 };
  const timers = fakeTimers();
  let calls = 0;
  let nextAt: string | null = "x";
  const s = createPulseScheduler({ config: () => cfg, run: async () => void calls++, setNextAt: (v) => (nextAt = v), timers });
  return { cfg, timers, s, calls: () => calls, nextAt: () => nextAt };
}

test("análises automáticas desligadas: o agendador não agenda nem chama o LLM", async () => {
  const t = setup(false);
  t.s.schedule();
  assert.equal(t.timers.pending.size, 0);
  assert.equal(t.nextAt(), null);
  await t.timers.fireAll();
  assert.equal(t.calls(), 0);
});

test("ligadas: agenda e chama o LLM a cada disparo", async () => {
  const t = setup(true);
  t.s.schedule();
  assert.equal(t.timers.pending.size, 1);
  await t.timers.fireAll();
  await t.timers.fireAll();
  assert.equal(t.calls(), 2);
});

test("desligar com turno já agendado: o disparo pendente não chama o LLM e não reagenda", async () => {
  const t = setup(true);
  t.s.schedule();
  t.cfg.enabled = false; // mudou fora da API (arquivo editado), sem reagendar
  await t.timers.fireAll();
  assert.equal(t.calls(), 0);
  assert.equal(t.timers.pending.size, 0);
  assert.equal(t.nextAt(), null);
});

test("desligar pela API (reagendar) cancela o timer pendente", async () => {
  const t = setup(true);
  t.s.schedule();
  t.cfg.enabled = false;
  t.s.schedule();
  assert.equal(t.timers.pending.size, 0);
  assert.equal(t.s.pending(), false);
});

// Anomalias marcadas por regra (camada 0). Toda marca é visível na UI —
// campo desconhecido nunca é descartado em silêncio.
import { P, readJson, writeJson } from "./store.ts";

export type FlagLevel = "info" | "warning" | "alert" | "error";
export type Flag = {
  key: string;
  kind: string;
  level: FlagLevel;
  title: string;
  detail: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  ack?: boolean;
};

let flags: Record<string, Flag> = readJson<Record<string, Flag>>(P.flags, {});
let dirty = false;

export function raiseFlag(f: Omit<Flag, "firstSeen" | "lastSeen" | "count">): void {
  const now = new Date().toISOString();
  const cur = flags[f.key];
  if (cur) {
    cur.lastSeen = now;
    cur.count += 1;
    cur.detail = f.detail;
    cur.level = f.level;
  } else {
    flags[f.key] = { ...f, firstSeen: now, lastSeen: now, count: 1 };
  }
  dirty = true;
}

export function clearFlag(key: string): void {
  if (flags[key]) {
    delete flags[key];
    dirty = true;
  }
}

export function ackFlag(key: string): boolean {
  const f = flags[key];
  if (!f) return false;
  f.ack = true;
  dirty = true;
  return true;
}

export function listFlags(): Flag[] {
  return Object.values(flags).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function flushFlags(): boolean {
  if (!dirty) return false;
  writeJson(P.flags, flags);
  dirty = false;
  return true;
}

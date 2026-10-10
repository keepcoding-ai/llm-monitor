import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { killTree } from "./process.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("killTree mata o filho e o neto", async () => {
  const grand = `setInterval(()=>{},1000)`;
  const parent = `const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e',${JSON.stringify(grand)}],{stdio:'ignore'});console.log(g.pid);setInterval(()=>{},1000)`;
  const child = spawn(process.execPath, ["-e", parent], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, detached: process.platform !== "win32" });
  const grandPid = await new Promise<number>((res) => child.stdout!.once("data", (d) => res(Number(String(d).trim()))));
  const childPid = child.pid!;
  assert.ok(alive(childPid) && alive(grandPid));
  await killTree(childPid);
  const deadline = Date.now() + 5000;
  while ((alive(childPid) || alive(grandPid)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(childPid), false);
  assert.equal(alive(grandPid), false);
});

test("killTree com pid inválido não explode", async () => {
  await killTree(0);
  await killTree(NaN);
});

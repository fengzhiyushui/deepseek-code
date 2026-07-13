// tests/unit/tui/recovery-clear.test.js — /recovery clear 与 CLI 对齐(facade/校验/成功/失败)。
import test from "node:test";
import assert from "node:assert/strict";
import { createTuiApp } from "../../../src/apps/tui/tui-app.js";
import { makeIO, until, tmpRoot } from "./helpers.js";

function kernelWithRecovery(recovery) {
  const subs = new Set();
  return {
    session: { subscribe(fn) { subs.add(fn); return { unsubscribe: () => subs.delete(fn) }; } },
    runtime: { getState: () => ({ current: "idle", channel: null }) },
    metrics: { getUsage: () => ({ total_tokens: 0, cache_hit_rate: 0 }) },
    agent: { send: async () => ({ status: "complete", content: "" }), approve: async () => ({}) },
    recovery,
    async dispose() {}
  };
}

async function boot(recovery) {
  const io = makeIO();
  const root = await tmpRoot();
  const app = createTuiApp({
    root, input: io.input, output: io.output,
    createKernelImpl: async () => kernelWithRecovery(recovery),
    buildKernelOptionsImpl: async () => ({})
  });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  const quit = async () => { io.input.write("\x03"); io.input.write("\x03"); await done; };
  return { io, quit };
}

test("/recovery clear <id> calls facade and renders status", async () => {
  const calls = [];
  const { io, quit } = await boot({
    report: async () => ({ found: [], done: [], blocked: [] }),
    list: async () => [],
    clear: async (id) => { calls.push(id); return { status: "cleared" }; }
  });
  io.input.write("/recovery clear rec_1\r");
  await until(() => io.text().includes("rec_1"));
  assert.deepEqual(calls, ["rec_1"]);
  assert.match(io.text(), /rec_1.*cleared/);
  await quit();
});

test("/recovery clear without id prints usage, no facade call", async () => {
  let called = false;
  const { io, quit } = await boot({
    report: async () => ({ found: [], done: [], blocked: [] }),
    list: async () => [],
    clear: async () => { called = true; return {}; }
  });
  io.input.write("/recovery clear\r");
  await until(() => io.text().includes("resume|cancel|clear"));
  assert.equal(called, false);
  await quit();
});

test("/recovery clear failure renders error, no crash", async () => {
  const { io, quit } = await boot({
    report: async () => ({ found: [], done: [], blocked: [] }),
    list: async () => [],
    clear: async () => { throw new Error("cannot clear blocked recovery item"); }
  });
  io.input.write("/recovery clear rec_2\r");
  await until(() => io.text().includes("cannot clear blocked"));
  assert.match(io.text(), /cannot clear blocked/);
  await quit();
});

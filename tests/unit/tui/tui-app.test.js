import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTuiApp } from "../../../src/apps/tui/tui-app.js";
import { loadTuiPrefs, saveTuiPrefs } from "../../../src/apps/tui/prefs.js";

function makeIO() {
  const input = new PassThrough();
  input.setRawMode = () => {};
  input.isTTY = true;
  const output = new PassThrough();
  output.columns = 80;
  const chunks = [];
  output.on("data", (c) => chunks.push(String(c)));
  return { input, output, text: () => chunks.join("") };
}

function makeFakeKernel({ onSend, onApprove } = {}) {
  const subs = new Set();
  const kernel = {
    disposed: false,
    session: { subscribe(fn) { subs.add(fn); return { unsubscribe: () => subs.delete(fn) }; } },
    runtime: { getState: () => ({ current: "idle", channel: null }) },
    metrics: { getUsage: () => ({ total_tokens: 42, cache_hit_rate: 0.5 }) },
    agent: {
      send: (text, options) => onSend({ text, options, emit }),
      approve: (id, decision) => onApprove({ id, decision })
    },
    async dispose() { kernel.disposed = true; }
  };
  function emit(ev) { for (const fn of subs) fn(ev); }
  kernel.emit = emit;
  return kernel;
}

async function until(fn, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "dsc-tui-"));
}

test("prefs roundtrip", async () => {
  const root = await tmpRoot();
  assert.deepEqual(await loadTuiPrefs(root), {});
  await saveTuiPrefs(root, { lang: "en" });
  assert.deepEqual(await loadTuiPrefs(root), { lang: "en" });
});

test("full streaming round: echo, deltas, final, history", async () => {
  const io = makeIO();
  const sends = [];
  const kernel = makeFakeKernel({
    onSend: async ({ text, options }) => {
      sends.push({ text, options });
      options.onDelta("你好");
      options.onDelta("世界");
      return { status: "complete", content: "你好世界" };
    }
  });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("hi\r");
  await until(() => io.text().includes("你好世界"));
  assert.match(io.text(), /❯ hi/);
  assert.equal(sends[0].options.autonomy, "gated");
  assert.equal(sends[0].options.stream, true);
  io.input.write("again\r");
  await until(() => sends.length === 2);
  assert.equal(sends[1].options.history.length, 2); // 上一轮 user+assistant
  assert.equal(sends[1].options.history[0].content, "hi");
  io.input.write("\x03");
  io.input.write("\x03");
  await done;
  assert.ok(io.text().includes("\x1b[?2004l")); // pasteOff
  assert.ok(io.text().includes("\x1b[?25h"));   // showCursor
  assert.equal(kernel.disposed, false);          // 注入的 kernel 不由 app dispose
});

test("approval flow: y approves, esc denies", async () => {
  const io = makeIO();
  const approvals = [];
  let phase = 0;
  const kernel = makeFakeKernel({
    onSend: async ({ emit }) => {
      phase += 1;
      emit({ type: "approval:requested", approval: { id: `ap_${phase}`, summary: `write file ${phase}` } });
      return { status: "awaiting_approval", approval: { id: `ap_${phase}`, summary: `write file ${phase}` } };
    },
    onApprove: async ({ id, decision }) => {
      approvals.push({ id, decision });
      return { status: "complete", content: "done" };
    }
  });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("do it\r");
  await until(() => io.text().includes("审批"));
  io.input.write("y");
  await until(() => approvals.length === 1);
  assert.deepEqual(approvals[0], { id: "ap_1", decision: "approve" });
  io.input.write("redo\r");
  await until(() => io.text().includes("write file 2")); // 第二轮审批卡片可见(按轮次区分,避免重绘计数竞态)
  io.input.write("\x1b"); // Esc → deny
  await until(() => approvals.length === 2);
  assert.equal(approvals[1].decision, "deny");
  io.input.write("\x03");
  io.input.write("\x03");
  await done;
});

test("kernel events render as cards; ctrl_c single press hints", async () => {
  const io = makeIO();
  const kernel = makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  kernel.emit({ type: "tool:call", call: { name: "read", args: { path: "a.js" } } });
  await until(() => io.text().includes("tool ▸ read"));
  io.input.write("\x03");
  await until(() => io.text().includes("再按一次"));
  await new Promise((r) => setTimeout(r, 20));
  io.input.write("\x03"); // 20ms 内第二次 → 退出
  await done;
});

test("offline kernel: banner + offline notice on submit", async () => {
  const io = makeIO();
  const app = createTuiApp({
    root: await tmpRoot(),
    input: io.input,
    output: io.output,
    createKernelImpl: async () => { throw new Error("no key"); },
    buildKernelOptionsImpl: async () => ({})
  });
  const done = app.run();
  await until(() => io.text().includes("内核不可用"));
  io.input.write("hello\r");
  await until(() => io.text().split("内核不可用").length > 2);
  io.input.write("\x03");
  io.input.write("\x03");
  await done;
});

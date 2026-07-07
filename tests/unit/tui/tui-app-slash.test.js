// tests/unit/tui/tui-app-slash.test.js — slash 命令接线全链路(注入 IO + mock kernel)。
import test from "node:test";
import assert from "node:assert/strict";
import { createTuiApp } from "../../../src/apps/tui/tui-app.js";
import { loadTuiPrefs } from "../../../src/apps/tui/prefs.js";
import { makeIO, makeFakeKernel, until, tmpRoot } from "./helpers.js";

test("/help lists registered commands", async () => {
  const io = makeIO();
  const kernel = makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/help\r");
  await until(() => io.text().includes("/quit"));
  assert.match(io.text(), /\/mode/);
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("typing / opens filtered menu; tab completes; enter runs selection", async () => {
  const io = makeIO();
  const kernel = makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/cl");
  await until(() => io.text().includes("/clear"));
  io.input.write("\t"); // Tab 补全
  io.input.write("\r");
  await until(() => io.text().includes("已清空会话上下文"));
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("/mode auto changes autonomy for next send; bad arg rejected", async () => {
  const io = makeIO();
  const sends = [];
  const kernel = makeFakeKernel({ onSend: async ({ text, options }) => { sends.push(options); return { status: "complete", content: "" }; } });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/mode auto\r");
  await until(() => io.text().includes("模式:auto"));
  io.input.write("go\r");
  await until(() => sends.length === 1);
  assert.equal(sends[0].autonomy, "auto");
  io.input.write("/mode bogus\r");
  await until(() => io.text().includes("模式必须是"));
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("/clear wipes conversation history", async () => {
  const io = makeIO();
  const sends = [];
  const kernel = makeFakeKernel({ onSend: async ({ options }) => { sends.push(options); return { status: "complete", content: "r" }; } });
  const app = createTuiApp({ root: await tmpRoot(), kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("one\r");
  await until(() => sends.length === 1);
  io.input.write("/clear\r");
  await until(() => io.text().includes("已清空"));
  io.input.write("two\r");
  await until(() => sends.length === 2);
  assert.equal(sends[1].history.length, 0);
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("/lang en switches ui language and persists", async () => {
  const io = makeIO();
  const root = await tmpRoot();
  const kernel = makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  const app = createTuiApp({ root, kernel, input: io.input, output: io.output });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/lang en\r");
  await until(() => io.text().includes("Language: English"));
  assert.equal((await loadTuiPrefs(root)).lang, "en");
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("/diff renders injected diff; /quit exits", async () => {
  const io = makeIO();
  const kernel = makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  const app = createTuiApp({
    root: await tmpRoot(), kernel, input: io.input, output: io.output,
    showDiffImpl: async () => "+added line\n-removed line"
  });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/diff\r");
  await until(() => io.text().includes("+added line"));
  io.input.write("/quit\r");
  await done;
});

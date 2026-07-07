// tests/unit/tui/tui-app-config.test.js — /config 全链路(共享存储/激活重建/掩码不上屏)。
import test from "node:test";
import assert from "node:assert/strict";
import { createTuiApp } from "../../../src/apps/tui/tui-app.js";
import { createApiProfiles } from "../../../src/apps/api-profiles.js";
import { makeIO, makeFakeKernel, until, tmpRoot } from "./helpers.js";
import path from "node:path";

function fakeKernelFactory(log) {
  return async () => {
    log.created += 1;
    return makeFakeKernel({ onSend: async () => ({ status: "complete", content: "" }) });
  };
}

test("/config add-new flow saves profile to shared store; key never echoed", async () => {
  const io = makeIO();
  const root = await tmpRoot();
  const log = { created: 0 };
  const app = createTuiApp({
    root, input: io.input, output: io.output,
    createKernelImpl: fakeKernelFactory(log), buildKernelOptionsImpl: async () => ({})
  });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/config\r");
  await until(() => io.text().includes("+ 新增配置"));
  io.input.write("\r");                    // 选「新增」(空列表 index=0)
  await until(() => io.text().includes("名称"));
  io.input.write("p1\r");                  // name → 下一项
  io.input.write("\r");                    // baseUrl 保默认 → 下一项
  io.input.write("sk-1234567890abcd\r");   // apiKey → 下一项
  io.input.write("deepseek-chat\r");       // model,最后一项 Enter = 保存
  await until(() => io.text().includes("配置已保存"));
  assert.doesNotMatch(io.text(), /sk-1234567890abcd/); // 明文永不上屏
  const store = createApiProfiles({ dir: path.join(root, ".deepseek-code") });
  const profiles = await store.list();
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].apiKey, "sk-1234567890abcd"); // 明文只在盘上
  io.input.write("\x1b");                  // Esc 回列表
  io.input.write("\x1b");                  // Esc 关闭 config
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("activate writes config and rebuilds kernel keeping history", async () => {
  const io = makeIO();
  const root = await tmpRoot();
  const store = createApiProfiles({ dir: path.join(root, ".deepseek-code") });
  const saved = await store.save({ name: "main", baseUrl: "https://x", apiKey: "sk-aaaaaaaaaa", model: "m9" });
  const log = { created: 0 };
  const patches = [];
  const app = createTuiApp({
    root, input: io.input, output: io.output,
    createKernelImpl: fakeKernelFactory(log), buildKernelOptionsImpl: async () => ({}),
    configureProjectImpl: async (r, patch) => { patches.push(patch); return { target: "x", config: patch }; }
  });
  const done = app.run();
  await until(() => log.created === 1);
  io.input.write("/config\r");
  await until(() => io.text().includes("main"));
  io.input.write("\r");                    // 选中 profile → actions
  await until(() => io.text().includes("激活"));
  io.input.write("\r");                    // 激活(actionIndex=0)
  await until(() => io.text().includes("已激活:main"));
  assert.equal(patches[0].apiKey, "sk-aaaaaaaaaa");
  assert.equal(patches[0].model, "m9");
  assert.equal(log.created, 2);            // kernel 重建
  assert.equal((await store.getActive()).id, saved.id);
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("models fetch failure shows red error, no default injected", async () => {
  const io = makeIO();
  const root = await tmpRoot();
  const store = createApiProfiles({ dir: path.join(root, ".deepseek-code") });
  await store.save({ name: "main", baseUrl: "https://x", apiKey: "sk-bbbbbbbbbb", model: "" });
  const log = { created: 0 };
  const app = createTuiApp({
    root, input: io.input, output: io.output,
    createKernelImpl: fakeKernelFactory(log), buildKernelOptionsImpl: async () => ({}),
    fetchModelIdsImpl: async () => { throw new Error("401 denied"); }
  });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/config\r");
  await until(() => io.text().includes("main"));
  io.input.write("\r");
  await until(() => io.text().includes("拉取模型列表"));
  io.input.write("\x1b[B\x1b[B");          // ↓↓ 到「拉取模型列表」
  io.input.write("\r");
  await until(() => io.text().includes("模型拉取失败"));
  assert.match(io.text(), /401 denied/);
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

test("connection test success shows notice", async () => {
  const io = makeIO();
  const root = await tmpRoot();
  const store = createApiProfiles({ dir: path.join(root, ".deepseek-code") });
  await store.save({ name: "main", baseUrl: "https://x", apiKey: "sk-cccccccccc", model: "m" });
  const app = createTuiApp({
    root, input: io.input, output: io.output,
    createKernelImpl: fakeKernelFactory({ created: 0 }), buildKernelOptionsImpl: async () => ({}),
    testConnectionImpl: async () => true
  });
  const done = app.run();
  await until(() => io.text().includes("❯"));
  io.input.write("/config\r");
  await until(() => io.text().includes("main"));
  io.input.write("\r");
  io.input.write("\x1b[B\x1b[B\x1b[B");    // ↓↓↓ 到「连接测试」
  io.input.write("\r");
  await until(() => io.text().includes("连接测试通过"));
  io.input.write("\x03"); io.input.write("\x03");
  await done;
});

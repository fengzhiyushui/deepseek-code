import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createKernelHost } = require("../../../gui/kernel-host.js");

// 造一个假 kernel 工厂,把 createKernel 收到的 options 抓出来
function hostWithCapturedOptions(pushed) {
  let captured = null;
  const host = createKernelHost({
    projectRoot: process.cwd(),
    kernelFactory: async (_root, options) => {
      captured = options;
      return { session: { subscribe: () => ({ unsubscribe() {} }) } };
    },
    configLoader: async () => ({}),
    pushEvent: (event) => pushed.push(event)
  });
  return { host, options: () => captured };
}

test("kernel host injects an onSensitiveNotice handler into the kernel", async () => {
  const pushed = [];
  const { host, options } = hostWithCapturedOptions(pushed);
  await host.init();
  assert.equal(typeof options().onSensitiveNotice, "function", "GUI 必须给内核接上提醒回调");
});

test("a sensitive notice is pushed to the renderer and resolves on response", async () => {
  const pushed = [];
  const { host, options } = hostWithCapturedOptions(pushed);
  await host.init();

  const pending = options().onSensitiveNotice({
    paths: [{ path: ".env", reason: "secret-file" }],
    recordDir: ".deepseek-code/changes"
  });

  const request = pushed.find((e) => e.type === "gui:sensitive_notice");
  assert.ok(request, "应向渲染层推送提醒请求");
  assert.ok(request.request_id, "请求必须带 id 以便作答");
  assert.equal(request.descriptor.paths[0].path, ".env");
  assert.equal(request.descriptor.severity, "danger");

  assert.equal(host.resolveSensitiveNotice(request.request_id, true), true);
  assert.equal(await pending, true);
});

test("responding false refuses the edit", async () => {
  const pushed = [];
  const { host, options } = hostWithCapturedOptions(pushed);
  await host.init();
  const pending = options().onSensitiveNotice({ paths: [{ path: ".env", reason: "secret-file" }] });
  const request = pushed.find((e) => e.type === "gui:sensitive_notice");
  host.resolveSensitiveNotice(request.request_id, false);
  assert.equal(await pending, false);
});

// 只有严格 true 才放行 —— 渲染层传来的任何其它值都按拒绝处理
test("only a strict true from the renderer allows the write", async () => {
  const pushed = [];
  const { host, options } = hostWithCapturedOptions(pushed);
  await host.init();
  for (const answer of ["true", 1, {}, null, undefined]) {
    const pending = options().onSensitiveNotice({ paths: [{ path: ".env", reason: "secret-file" }] });
    const req = pushed[pushed.length - 1];
    host.resolveSensitiveNotice(req.request_id, answer);
    assert.equal(await pending, false, `${String(answer)} 不得被当作同意`);
  }
});

test("unknown request ids are ignored (no hang, no crash)", async () => {
  const pushed = [];
  const { host } = hostWithCapturedOptions(pushed);
  await host.init();
  assert.equal(host.resolveSensitiveNotice("sn_does_not_exist", true), false);
});

// dispose 必须把未决提问按拒绝收口,否则关窗后主进程会永远挂在 await 上
test("dispose refuses any pending notice instead of hanging", async () => {
  const pushed = [];
  const { host, options } = hostWithCapturedOptions(pushed);
  await host.init();
  const pending = options().onSensitiveNotice({ paths: [{ path: ".env", reason: "secret-file" }] });
  host.dispose();
  assert.equal(await pending, false, "dispose 后未决提问必须按拒绝收口");
});

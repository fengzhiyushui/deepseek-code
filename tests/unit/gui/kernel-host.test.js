import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createKernelHost, resolveProjectRoot, zeroUsage, buildKernelOptions } = require("../../../gui/kernel-host.js");

test("resolveProjectRoot reads --project argument", () => {
  assert.equal(resolveProjectRoot(["electron", ".", "--project=C:\\repo"], "fallback"), "C:\\repo");
  assert.equal(resolveProjectRoot(["electron", "."], "fallback"), "fallback");
});

test("kernel host delegates send and pushes final event", async () => {
  const pushed = [];
  const host = createKernelHost({
    projectRoot: "/repo",
    pushEvent: (event) => pushed.push(event),
    kernelFactory: async () => ({
      session: {
        subscribe(handler) {
          handler({ type: "agent:final", content: "done" });
          return { unsubscribe() {} };
        },
        getTimeline: async () => [{ type: "agent:final" }]
      },
      agent: {
        send: async (message, opts) => ({ status: "complete", content: `${message}:${opts.autonomy}` }),
        approve: () => {},
        interrupt: () => {}
      },
      context: { snapshot: async () => ({ units: [] }) },
      config: { getPublicConfig: () => ({ runtime: "v2", has_api_key: false }) },
      runtime: { getState: () => ({ current: "idle", channel: null }) }
    })
  });

  await host.init();
  const response = await host.send("hello", { autonomy: "gated" });

  assert.deepEqual(response, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(pushed.some((event) => event.type === "agent:final"));
  // V2 runtime publishes agent:final natively; host must not duplicate agent:result
  assert.equal(pushed.some((event) => event.type === "agent:result"), false);
});

test("kernel host exposes safe default state and usage", async () => {
  const host = createKernelHost({
    projectRoot: "/repo",
    kernelFactory: async () => ({
      session: { subscribe: () => ({ unsubscribe() {} }), getTimeline: async () => [] },
      agent: { send: async () => ({ status: "complete" }), approve: () => {}, interrupt: () => {} },
      context: { snapshot: async () => ({ units: [] }) },
      config: { getPublicConfig: () => ({ runtime: "v2" }) },
      runtime: { getState: () => ({ current: "idle", channel: null }) }
    })
  });

  await host.init();
  assert.deepEqual(host.getUsage(), zeroUsage());
  assert.deepEqual(host.getState(), { current: "idle", channel: null });
  assert.deepEqual(host.getConfig(), { runtime: "v2" });
});

test("buildKernelOptions bridges legacy config into V2 DeepSeek options", async () => {
  const options = await buildKernelOptions("/repo", {}, async () => ({
    apiKey: "sk-gui",
    baseUrl: "https://example.invalid"
  }));

  assert.deepEqual(options, {
    deepseek: { apiKey: "sk-gui", baseUrl: "https://example.invalid" }
  });
});

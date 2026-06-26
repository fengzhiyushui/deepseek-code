import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKernelOptions } from "../src/apps/kernel-options.js";

test("forwards config.context into kernel options", async () => {
  const fakeLoad = async () => ({ apiKey: "k", baseUrl: "https://x", context: { semantic: { enabled: true, hops: 2, maxSymbols: 200, includeMethodHints: false } } });
  const out = await buildKernelOptions("/root", {}, fakeLoad);
  assert.deepEqual(out.context.semantic.enabled, true);
});

test("no context key when config lacks it", async () => {
  const fakeLoad = async () => ({ apiKey: "k", baseUrl: "https://x" });
  const out = await buildKernelOptions("/root", {}, fakeLoad);
  assert.equal(out.context, undefined);
});

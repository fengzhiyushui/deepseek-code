import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKernelOptions } from "../src/apps/kernel-options.js";

const cfg = { apiKey: "k", baseUrl: "https://x", context: { semantic: { enabled: false, hops: 2, maxSymbols: 200, includeMethodHints: false } } };

test("CLI override merges over config (override wins)", async () => {
  const out = await buildKernelOptions("/root", { context: { semantic: { enabled: true, includeMethodHints: true } } }, async () => cfg);
  assert.equal(out.context.semantic.enabled, true);
  assert.equal(out.context.semantic.includeMethodHints, true);
  assert.equal(out.context.semantic.hops, 2); // preserved from config
});

test("no override -> config.context passes through unchanged", async () => {
  const out = await buildKernelOptions("/root", {}, async () => cfg);
  assert.deepEqual(out.context, cfg.context);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildKernelOptions } from "../../../src/apps/kernel-options.js";

test("buildKernelOptions bridges legacy config into V2 DeepSeek options", async () => {
  const options = await buildKernelOptions("/repo", {}, async () => ({
    apiKey: "sk-test",
    baseUrl: "https://example.invalid"
  }));

  assert.deepEqual(options, {
    deepseek: { apiKey: "sk-test", baseUrl: "https://example.invalid" }
  });
});

test("buildKernelOptions preserves explicit modelGateway and does not read config", async () => {
  const gateway = { reply: async () => ({ content: "ok" }) };
  const options = await buildKernelOptions("/repo", { modelGateway: gateway }, async () => {
    throw new Error("should not load config");
  });

  assert.equal(options.modelGateway, gateway);
});

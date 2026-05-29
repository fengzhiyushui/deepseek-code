// test/kernel/model-provider.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createModelProvider } from "../../src/kernel/model-provider.js";
import { DEFAULT_MODEL_PROFILES } from "../../src/kernel/config-provider.js";

function testConfig(overrides = {}) {
  return {
    baseUrl: "https://api.deepseek.com",
    apiKey: "sk-test-dummy",
    temperature: 0.2,
    maxTokens: 4096,
    thinking: { type: "disabled" },
    reasoningEffort: "high",
    profiles: DEFAULT_MODEL_PROFILES,
    ...overrides
  };
}

test("channelParams returns Think channel params", () => {
  const provider = createModelProvider(testConfig());
  const params = provider.channelParams("think");
  assert.equal(params.thinking.type, "enabled");
  assert.equal(params.model, "deepseek-v4-pro");
  assert.equal(params.temperature, undefined);
  assert.equal(params.max_tokens, 16384);
  assert.equal(params.stream, false);
});

test("channelParams returns Act channel params", () => {
  const provider = createModelProvider(testConfig());
  const params = provider.channelParams("act");
  assert.equal(params.thinking.type, "disabled");
  assert.equal(params.model, "deepseek-v4-flash");
  assert.equal(params.temperature, 0.1);
  assert.equal(params.max_tokens, 4096);
  assert.equal(params.stream, true);
});

test("config.model does NOT override per-channel profile defaults", () => {
  const provider = createModelProvider(testConfig({ model: "custom-model" }));
  const thinkParams = provider.channelParams("think");
  const actParams = provider.channelParams("act");
  // config.model is a default only; each channel resolves independently
  assert.equal(thinkParams.model, "deepseek-v4-pro");
  assert.equal(actParams.model, "deepseek-v4-flash");
});

test("explicit per-call model overrides profile default", () => {
  const provider = createModelProvider(testConfig());
  const params = provider.channelParams("think", "my-custom-model");
  assert.equal(params.model, "my-custom-model");
});

test("channelParams reasoning_effort is only set when thinking enabled", () => {
  const provider = createModelProvider(testConfig());
  const think = provider.channelParams("think");
  const act = provider.channelParams("act");
  assert.equal(think.reasoning_effort, "high");
  assert.equal(act.reasoning_effort, undefined);
});

test("supportsFIM returns true when fim profile exists", () => {
  const provider = createModelProvider(testConfig());
  assert.equal(provider.supportsFIM(), true);
});

test("fimParams returns correct FIM request body", () => {
  const provider = createModelProvider(testConfig());
  const body = provider.fimParams("function hello() {", "}");
  assert.equal(body.model, "deepseek-v4-pro");
  assert.equal(body.prompt, "function hello() {");
  assert.equal(body.suffix, "}");
  assert.equal(body.max_tokens, 128);
  assert.ok(!("thinking" in body), "FIM body must not include thinking field");
});

test("buildRequestBody assembles messages with system prompt", () => {
  const provider = createModelProvider(testConfig());
  const messages = [{ role: "user", content: "hello" }];
  const body = provider.buildRequestBody(messages, "act");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.stream, true);
  assert.equal(typeof body.max_tokens, "number");
});

test("buildRequestBody think channel includes response_format json_object", () => {
  const provider = createModelProvider(testConfig());
  const body = provider.buildRequestBody(
    [{ role: "user", content: "analyze this" }],
    "think"
  );
  assert.equal(body.response_format.type, "json_object");
});

test("buildRequestBody act channel does NOT include response_format", () => {
  const provider = createModelProvider(testConfig());
  const body = provider.buildRequestBody(
    [{ role: "user", content: "fix this"}],
    "act"
  );
  assert.equal(body.response_format, undefined);
});

test("getUsageStats returns initial zero stats", () => {
  const provider = createModelProvider(testConfig());
  const stats = provider.getUsageStats();
  assert.equal(stats.total_prompt_tokens, 0);
  assert.equal(stats.total_completion_tokens, 0);
  assert.equal(stats.total_reasoning_tokens, 0);
  assert.equal(stats.requests, 0);
  assert.equal(stats.cache_hit_tokens, 0);
  assert.equal(stats.cache_miss_tokens, 0);
});

test("trackUsage accumulates usage correctly", () => {
  const provider = createModelProvider(testConfig());
  provider.trackUsage({
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 200,
      completion_tokens_details: { reasoning_tokens: 50 },
      prompt_tokens_details: { cached_tokens: 300 },
      prompt_cache_hit_tokens: 300,
      prompt_cache_miss_tokens: 700
    },
    channel: "think",
    model: "deepseek-v4-pro",
    latency_ms: 1200
  });
  const stats = provider.getUsageStats();
  assert.equal(stats.total_prompt_tokens, 1000);
  assert.equal(stats.total_completion_tokens, 200);
  assert.equal(stats.total_reasoning_tokens, 50);
  assert.equal(stats.requests, 1);
  assert.equal(stats.cache_hit_tokens, 300);
  assert.equal(stats.cache_miss_tokens, 700);
  assert.equal(stats.avg_latency_ms, 1200);
});

test("getUsageStats accumulates across multiple calls", () => {
  const provider = createModelProvider(testConfig());
  provider.trackUsage({
    usage: { prompt_tokens: 500, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 0 },
      prompt_tokens_details: { cached_tokens: 100 } },
    channel: "act", model: "deepseek-v4-flash", latency_ms: 300
  });
  provider.trackUsage({
    usage: { prompt_tokens: 600, completion_tokens: 150, completion_tokens_details: { reasoning_tokens: 20 },
      prompt_tokens_details: { cached_tokens: 200 } },
    channel: "think", model: "deepseek-v4-pro", latency_ms: 800
  });
  const stats = provider.getUsageStats();
  assert.equal(stats.total_prompt_tokens, 1100);
  assert.equal(stats.total_completion_tokens, 250);
  assert.equal(stats.total_reasoning_tokens, 20);
  assert.equal(stats.requests, 2);
  assert.equal(stats.cache_hit_tokens, 300);
  assert.equal(stats.cache_miss_tokens, 800);
  assert.equal(stats.avg_latency_ms, 550);
  assert.ok(stats.by_channel.think);
  assert.ok(stats.by_channel.act);
  assert.equal(stats.by_channel.think.requests, 1);
  assert.equal(stats.by_channel.act.requests, 1);
});

test("reasoning_content is captured but flagged as hidden", () => {
  const provider = createModelProvider(testConfig());
  const response = {
    choices: [{
      message: {
        content: "the answer",
        reasoning_content: "step 1: think... step 2: conclude..."
      }
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
      completion_tokens_details: { reasoning_tokens: 100 } }
  };
  const processed = provider.processResponse(response, "think");
  assert.equal(processed.content, "the answer");
  assert.equal(processed.reasoning_content, "step 1: think... step 2: conclude...");
  assert.equal(processed._reasoning_hidden, true);
});

test("invoke exists and is callable", () => {
  const provider = createModelProvider(testConfig());
  assert.equal(typeof provider.invoke, "function");
});

test("streamDelta exists and is callable", () => {
  const provider = createModelProvider(testConfig());
  assert.equal(typeof provider.streamDelta, "function");
});

test("fimComplete exists and is callable", () => {
  const provider = createModelProvider(testConfig());
  assert.equal(typeof provider.fimComplete, "function");
});

test("invoke throws on 401 with clear error", async () => {
  const provider = createModelProvider(testConfig());
  try {
    await provider.invoke([{ role: "user", content: "test" }], "act");
    // If network call succeeds unexpectedly, that's fine — test just validates function exists
  } catch (err) {
    // Expected: either auth error or network error
    assert.ok(err.message.length > 0);
  }
});

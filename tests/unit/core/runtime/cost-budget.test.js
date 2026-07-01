import test from "node:test";
import assert from "node:assert/strict";
import { createCostBudget } from "../../../../src/core/runtime/cost-budget.js";

test("null limits never exceed", () => {
  const b = createCostBudget({});
  b.recordModelResult({ usage: { total_tokens: 999999 } });
  assert.equal(b.exceeded(), null);
  b.check(); // 不抛
  assert.deepEqual(b.snapshot(), { tokens: 999999, model_calls: 1, max_tokens: null, max_model_calls: null });
});

test("max_tokens trips after accumulation", () => {
  const b = createCostBudget({ maxTokens: 100 });
  b.recordModelResult({ usage: { total_tokens: 60 } });
  assert.equal(b.exceeded(), null);
  b.recordModelResult({ usage: { total_tokens: 60 } }); // 累计 120 >= 100
  assert.equal(b.exceeded().reason, "max_tokens");
  assert.throws(() => b.check(), (e) => e.code === "BUDGET_EXCEEDED" && e.details.reason === "max_tokens");
});

test("total_tokens falls back to prompt+completion", () => {
  const b = createCostBudget({ maxTokens: 50 });
  b.recordModelResult({ usage: { prompt_tokens: 30, completion_tokens: 25 } }); // 55
  assert.equal(b.exceeded().reason, "max_tokens");
});

test("max_model_calls trips after N calls", () => {
  const b = createCostBudget({ maxModelCalls: 2 });
  b.recordModelResult({ usage: { total_tokens: 1 } });
  b.check();
  b.recordModelResult({ usage: { total_tokens: 1 } });
  assert.throws(() => b.check(), (e) => e.code === "BUDGET_EXCEEDED" && e.details.reason === "max_model_calls");
});

test("missing usage still counts a model call", () => {
  const b = createCostBudget({ maxModelCalls: 1 });
  b.recordModelResult({});
  assert.equal(b.snapshot().model_calls, 1);
  assert.throws(() => b.check(), (e) => e.code === "BUDGET_EXCEEDED");
});

test("initial seeds continue deducting from prior spend (durable resume — CST-8)", () => {
  const b = createCostBudget({ maxTokens: 100, initialTokens: 90 });
  assert.equal(b.snapshot().tokens, 90);
  assert.equal(b.exceeded(), null);
  b.recordModelResult({ usage: { total_tokens: 15 } }); // 90 + 15 = 105 >= 100
  assert.equal(b.exceeded().reason, "max_tokens");
});

test("initial model-call seed can already be at cap on resume", () => {
  const b = createCostBudget({ maxModelCalls: 3, initialModelCalls: 3 });
  assert.equal(b.snapshot().model_calls, 3);
  assert.equal(b.exceeded().reason, "max_model_calls");
});

test("default seeds are zero (no regression)", () => {
  const b = createCostBudget({ maxTokens: 100 });
  assert.deepEqual(b.snapshot(), { tokens: 0, model_calls: 0, max_tokens: 100, max_model_calls: null });
});


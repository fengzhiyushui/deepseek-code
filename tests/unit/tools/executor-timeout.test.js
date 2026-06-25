import test from "node:test";
import assert from "node:assert/strict";
import { createToolExecutor } from "../../../src/tools/executor.js";

function fakeRegistry(execFn) {
  const def = {
    name: "slow",
    category: "read",
    risk_level: "low",
    execute: execFn,
    normalizeParams: (p) => p,
    resolveCategory: () => "read"
  };
  return {
    resolve: (name) => (name === "slow" ? def : null),
    secureToolCall: (call) => ({ ...call, category: "read", params: call.params || {} })
  };
}
const allowEngine = { decide: () => ({ decision: "allow", matched_rule: "test" }) };
const call = { id: "tc_1", name: "slow", params: {} };

test("tool exec times out into an error result", async () => {
  const registry = fakeRegistry(() => new Promise(() => {})); // 永不解决
  const executor = createToolExecutor({ registry, permissionEngine: allowEngine, defaultToolTimeoutMs: 20 });
  const result = await executor.execute(call, { turnId: "t1" });
  assert.equal(result.status, "error");
  assert.equal(result.metadata.timeout, true);
  assert.match(result.content[0].text, /timed out/i);
});

test("fast tool under timeout succeeds", async () => {
  const registry = fakeRegistry(async () => ({ status: "success", content: [{ type: "text", text: "done" }] }));
  const executor = createToolExecutor({ registry, permissionEngine: allowEngine, defaultToolTimeoutMs: 1000 });
  const result = await executor.execute(call, { turnId: "t1" });
  assert.equal(result.status, "success");
});

test("no timeout configured keeps current behavior", async () => {
  const registry = fakeRegistry(async () => ({ status: "success", content: [] }));
  const executor = createToolExecutor({ registry, permissionEngine: allowEngine });
  const result = await executor.execute(call, { turnId: "t1" });
  assert.equal(result.status, "success");
});

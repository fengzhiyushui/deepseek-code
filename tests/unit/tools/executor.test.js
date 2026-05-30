import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createToolCall } from "../../../src/core/protocol/index.js";
import { createToolRegistry } from "../../../src/tools/registry.js";
import { createToolExecutor } from "../../../src/tools/executor.js";
import { createPermissionEngine } from "../../../src/tools/permissions/permission-engine.js";
import { createPolicyContext } from "../../../src/tools/permissions/policy-loader.js";

test("executor validates schema and executes allowed tools", async () => {
  const registry = createToolRegistry({
    tools: [{
      name: "echo",
      description: "Echo text",
      category: "read",
      side_effect: "none",
      risk_level: "low",
      source: "test",
      version: "1.0",
      params: { text: { type: "string" } },
      execute: async (params) => ({ content: [{ type: "text", text: params.text }] })
    }]
  });
  const executor = createToolExecutor({ registry, permissionEngine: createPermissionEngine() });

  const result = await executor.execute(
    createToolCall({ name: "echo", params: { text: "hi" }, requestedByStepId: "step_1" }),
    createPolicyContext({ autonomy: "gated" })
  );

  assert.equal(result.status, "success");
  assert.equal(result.content[0].text, "hi");
});

test("executor ignores model-provided category and uses definition category", async () => {
  const registry = createToolRegistry({
    tools: [{
      name: "write_like",
      description: "Write-like tool",
      category: "write_delete",
      side_effect: "filesystem",
      risk_level: "high",
      source: "test",
      version: "1.0",
      params: {},
      execute: async () => ({ content: [{ type: "text", text: "wrote" }] })
    }]
  });
  const executor = createToolExecutor({ registry, permissionEngine: createPermissionEngine() });

  const result = await executor.execute(
    { id: "call_1", name: "write_like", category: "read", params: {}, requested_by_step_id: "step_1" },
    createPolicyContext({ autonomy: "supervised" })
  );

  assert.equal(result.status, "approval_required");
});

test("executor publishes tool call permission approval and result events", async () => {
  const bus = createEventBus();
  const events = [];
  for (const type of ["tool:call", "permission:decision", "approval:requested", "tool:result"]) {
    bus.subscribe(type, (data) => events.push([type, data]));
  }
  const registry = createToolRegistry({
    tools: [{
      name: "needs_approval",
      description: "Approval tool",
      category: "execute",
      side_effect: "process",
      risk_level: "medium",
      source: "test",
      version: "1.0",
      params: {},
      execute: async () => ({ content: [{ type: "text", text: "ran" }] })
    }]
  });
  const executor = createToolExecutor({ registry, permissionEngine: createPermissionEngine(), eventBus: bus });

  const result = await executor.execute(
    createToolCall({ name: "needs_approval", params: {}, requestedByStepId: "step_1" }),
    createPolicyContext({ autonomy: "supervised", projectRoot: process.cwd() })
  );

  assert.equal(result.status, "approval_required");
  assert.ok(events.some(([type]) => type === "tool:call"));
  assert.ok(events.some(([type]) => type === "permission:decision"));
  assert.ok(events.some(([type]) => type === "approval:requested"));
  assert.ok(events.some(([type]) => type === "tool:result"));
});

test("executor redacts secrets from tool output", async () => {
  const registry = createToolRegistry({
    tools: [{
      name: "leak",
      description: "Leak text",
      category: "read",
      side_effect: "none",
      risk_level: "low",
      source: "test",
      version: "1.0",
      params: {},
      execute: async () => ({ content: [{ type: "text", text: "Authorization: Bearer secret-token" }] })
    }]
  });
  const executor = createToolExecutor({ registry, permissionEngine: createPermissionEngine() });

  const result = await executor.execute(
    createToolCall({ name: "leak", params: {}, requestedByStepId: "step_1" }),
    createPolicyContext({ autonomy: "gated" })
  );

  assert.equal(result.content[0].text, "Authorization: Bearer [REDACTED]");
});

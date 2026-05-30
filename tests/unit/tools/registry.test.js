import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltinTools } from "../../../src/tools/builtin/index.js";
import { createToolRegistry } from "../../../src/tools/registry.js";

test("builtin registry exposes expected tools", () => {
  const registry = createToolRegistry({ tools: createBuiltinTools() });
  const names = registry.listTools().map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "ask_user", "diff_apply", "diff_preview", "diff_rollback", "edit",
    "git", "glob", "grep", "ls", "memory", "read", "shell", "task", "test", "web_fetch"
  ].sort());
});

test("registry rejects duplicate tool names", () => {
  const registry = createToolRegistry();
  registry.register({ name: "x", description: "x", category: "read", params: {}, execute: async () => ({ content: [] }) });
  assert.throws(
    () => registry.register({ name: "x", description: "x", category: "read", params: {}, execute: async () => ({ content: [] }) }),
    /already registered/
  );
});

test("registry filters tools and exports DeepSeek schemas", () => {
  const registry = createToolRegistry({ tools: createBuiltinTools() });

  assert.ok(registry.listTools({ category: "read" }).some((tool) => tool.name === "read"));
  const schemas = registry.toDeepSeekTools();
  assert.ok(schemas.some((schema) => schema.function.name === "read"));
});

test("registry normalization uses tool normalizeParams hook", () => {
  const registry = createToolRegistry({ tools: createBuiltinTools() });

  assert.throws(
    () => registry.normalizeParams("shell", { cmd: "npm test" }),
    /structured argv/
  );
});

test("registry secureToolCall normalizes params and uses definition category", () => {
  const registry = createToolRegistry({
    tools: [{
      name: "memory",
      description: "memory",
      category: "read",
      risk_level: "medium",
      side_effect: "none",
      params: {
        action: { type: "string" },
        key: { type: "string", required: false }
      },
      resolveCategory: (params) => params.action === "write" ? "write_update" : "read",
      execute: async () => ({ status: "success", content: [] })
    }]
  });

  const secured = registry.secureToolCall({
    id: "call_1",
    name: "memory",
    params: { action: "write", key: "style" },
    category: "read_secret",
    requested_by_step_id: "step_1"
  });

  assert.equal(secured.name, "memory");
  assert.equal(secured.category, "write_update");
  assert.equal(secured.risk_level, "medium");
  assert.equal(secured.requested_by_step_id, "step_1");
  assert.deepEqual(secured.params, { action: "write", key: "style" });
});

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

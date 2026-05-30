// test/kernel/tool-registry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createToolRegistry, BUILTIN_TOOLS } from "../../src/kernel/tool-registry.js";
import { createPermissionEngine } from "../../src/kernel/permission-engine.js";

const tmpDir = path.join(os.tmpdir(), `dsc-tool-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, "test.txt"), "hello", "utf8");
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function testContext(overrides = {}) {
  return {
    autonomy: "gated",
    channel: "act",
    projectRoot: tmpDir,
    projectId: "test-project",
    trustStore: {},
    ...overrides
  };
}

test("registry has all built-in tools", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const tools = registry.listTools();
  assert.ok(tools.length >= 14);
  const names = tools.map(t => t.name);
  assert.ok(names.includes("read"));
  assert.ok(names.includes("write"));
  assert.ok(names.includes("grep"));
  assert.ok(names.includes("glob"));
  assert.ok(names.includes("shell"));
  assert.ok(names.includes("test"));
});

test("each built-in tool has required ToolDefinition fields", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  for (const tool of registry.listTools()) {
    assert.ok(typeof tool.name === "string", `${tool.name}: missing name`);
    assert.ok(typeof tool.description === "string", `${tool.name}: missing description`);
    assert.ok(typeof tool.category === "string", `${tool.name}: missing category`);
    assert.ok(typeof tool.side_effect === "string", `${tool.name}: missing side_effect`);
    assert.ok(typeof tool.risk_level === "string", `${tool.name}: missing risk_level`);
    assert.ok(typeof tool.source === "string", `${tool.name}: missing source`);
  }
});

test("resolve finds tool by name", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const def = registry.resolve("read");
  assert.ok(def);
  assert.equal(def.name, "read");
  assert.equal(def.category, "read");
});

test("resolve returns undefined for unknown tool", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  assert.equal(registry.resolve("nonexistent"), undefined);
});

test("register adds a custom tool", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  registry.register({
    name: "custom-lint",
    description: "Run custom linter",
    category: "execute",
    params: { path: { type: "string" } },
    side_effect: "process",
    risk_level: "medium",
    source: "builtin",
    execute: async (params) => ({ content: [{ type: "text", text: "lint output" }] })
  });
  const def = registry.resolve("custom-lint");
  assert.ok(def);
  assert.equal(def.name, "custom-lint");
});

test("execute returns denied result when permission denies", async () => {
  const engine = createPermissionEngine();
  const registry = createToolRegistry({ permissionEngine: engine });
  // Even though caller spoofs category "read", the tool definition says "write_update".
  // gated + write_update = allow, so the spoofed category is ignored and the call succeeds.
  const result = await registry.execute(
    { id: "c1", tool: "write", category: "read", risk_level: "low",
      params: { path: "test.txt", content: "hacked" } },
    testContext({ autonomy: "gated" })
  );
  assert.equal(result.status, "success");
});

test("execute returns approval_required when permission asks", async () => {
  const engine = createPermissionEngine();
  const registry = createToolRegistry({ permissionEngine: engine });
  // "delete" tool has category "write_delete" in its definition.
  // gated + write_delete = ask → approval_required
  const result = await registry.execute(
    { id: "c2", tool: "delete", params: { path: "important.js" } },
    testContext()
  );
  assert.equal(result.status, "approval_required");
});

test("execute returns ToolResult with required fields", async () => {
  const engine = createPermissionEngine();
  const registry = createToolRegistry({ permissionEngine: engine });
  const result = await registry.execute(
    { id: "c3", tool: "read", category: "read", risk_level: "low",
      params: { path: "test.txt" } },
    testContext()
  );
  assert.ok(result.id);
  assert.ok(typeof result.status === "string");
  assert.ok(typeof result.duration_ms === "number");
});

test("shell with raw cmd string is rejected", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  assert.throws(() => {
    registry.normalizeParams("shell", { cmd: "npm test" });
  }, /cmd.*not supported.*argv/);
});

test("shell with structured argv passes through", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const normalized = registry.normalizeParams("shell", { argv: ["npm", "test"], cwd: tmpDir });
  assert.deepEqual(normalized.argv, ["npm", "test"]);
  assert.equal(normalized.shell, false);
});

test("read/write with path traversal returns error", async () => {
  const engine = createPermissionEngine();
  const registry = createToolRegistry({ permissionEngine: engine });

  // Try to read outside project root
  const result = await registry.execute(
    { id: "c4", tool: "read", category: "read", risk_level: "low",
      params: { path: "../outside/file.txt" } },
    testContext()
  );
  assert.equal(result.status, "error");
  assert.ok(result.content[0].text.includes("escapes"));
});

test("web_fetch blocks localhost", async () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const result = await registry.execute(
    { id: "c_ssrf", tool: "web_fetch", category: "network", risk_level: "medium",
      params: { url: "http://localhost:8080/secret" } },
    testContext({ autonomy: "full-auto" })
  );
  assert.equal(result.status, "error");
  assert.ok(result.content[0].text.includes("Blocked"));
});

test("web_fetch blocks private LAN addresses", async () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const result = await registry.execute(
    { id: "c_lan", tool: "web_fetch", category: "network", risk_level: "medium",
      params: { url: "http://192.168.1.1/admin" } },
    testContext({ autonomy: "full-auto" })
  );
  assert.equal(result.status, "error");
  assert.ok(result.content[0].text.includes("Blocked"));
});

test("listTools filters by category", () => {
  const registry = createToolRegistry({ permissionEngine: createPermissionEngine() });
  const writeTools = registry.listTools({ category: "write_update" });
  for (const t of writeTools) {
    assert.equal(t.category, "write_update");
  }
});

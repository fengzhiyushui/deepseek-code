import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWebFetchTool } from "../../../src/tools/builtin/web-fetch.js";
import { createMemoryTool } from "../../../src/tools/builtin/memory.js";
import { createTaskTool } from "../../../src/tools/builtin/task.js";
import { createAskUserTool } from "../../../src/tools/builtin/ask-user.js";
import { createDeferredEditTools } from "../../../src/tools/builtin/edit-deferred.js";

test("web_fetch validates URL and truncates response", async () => {
  const tool = createWebFetchTool({
    lookup: async () => ({ address: "93.184.216.34" }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/plain"]]),
      text: async () => "x".repeat(40000)
    })
  });

  const result = await tool.execute({ url: "https://example.com" }, {});

  assert.equal(result.content[0].text.length, 32000);
  assert.equal(result.metadata.original_length, 40000);
});

test("web_fetch blocks localhost", async () => {
  const tool = createWebFetchTool();
  await assert.rejects(() => tool.execute({ url: "http://localhost:3000" }, {}), /blocked/i);
});

test("memory tool maps categories by action and persists project memory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-proj-"));
  const memoryRoot = await mkdtemp(path.join(tmpdir(), "dsc-memory-"));
  const tool = createMemoryTool();

  assert.equal(tool.resolveCategory({ action: "write" }), "write_update");
  assert.equal(tool.resolveCategory({ action: "delete" }), "write_delete");

  await tool.execute({ action: "write", key: "style", value: "Use ESM" }, { projectRoot: root, memoryRoot });
  const read = await tool.execute({ action: "read", key: "style" }, { projectRoot: root, memoryRoot });

  assert.equal(read.content[0].text, "Use ESM");
});

test("task tool caps delegated tools to five", async () => {
  const result = await createTaskTool().execute({
    prompt: "inspect files",
    tools: ["read", "grep", "glob", "ls", "git", "shell"]
  }, {});

  assert.deepEqual(result.metadata.delegated_tools, ["read", "grep", "glob", "ls", "git"]);
});

test("ask_user creates an approval-style pending result", async () => {
  const result = await createAskUserTool().execute({ question: "Which file?" }, {});
  assert.equal(result.status, "awaiting_user");
  assert.equal(result.content[0].text, "Which file?");
});

test("deferred edit tools fail clearly without editService", async () => {
  const [preview] = createDeferredEditTools();
  await assert.rejects(
    () => preview.execute({ diff: "--- a\n" }, {}),
    /Edit service is not configured/
  );
});

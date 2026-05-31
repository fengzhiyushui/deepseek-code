import test from "node:test";
import assert from "node:assert/strict";
import {
  createContextUnit,
  estimateTokens,
  priorityForPath,
  clipSnippet
} from "../../../src/context/context-unit.js";

test("createContextUnit returns deterministic id and content hash", () => {
  const first = createContextUnit({
    path: "src/index.js",
    content: "export const value = 1;\n",
    reason: "mentioned",
    now: "2026-05-31T00:00:00.000Z"
  });
  const second = createContextUnit({
    path: "src/index.js",
    content: "export const value = 1;\n",
    reason: "mentioned",
    now: "2026-05-31T00:00:01.000Z"
  });

  assert.equal(first.id, second.id);
  assert.equal(first.hash, second.hash);
  assert.equal(first.path, "src/index.js");
  assert.equal(first.type, "file");
  assert.equal(first.reason, "mentioned");
  assert.equal(first.priority, 2);
  assert.equal(first.bytes, Buffer.byteLength("export const value = 1;\n"));
  assert.ok(first.token_count > 0);
  assert.equal(first.updated_at, "2026-05-31T00:00:00.000Z");
});

test("priorityForPath assigns stable prefix priorities", () => {
  assert.deepEqual(priorityForPath("package.json"), { priority: 0, reason: "project-manifest" });
  assert.deepEqual(priorityForPath("README.md"), { priority: 0, reason: "project-doc" });
  assert.deepEqual(priorityForPath("environment.yml"), { priority: 0, reason: "project-manifest" });
  assert.deepEqual(priorityForPath("src/cli.js"), { priority: 2, reason: "source" });
  assert.deepEqual(priorityForPath("tests/unit/example.test.js"), { priority: 2, reason: "test" });
  assert.deepEqual(priorityForPath("docs/notes.md"), { priority: 3, reason: "cold" });
});

test("estimateTokens is deterministic and never returns zero for content", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(17)), 5);
});

test("clipSnippet bounds text by character count", () => {
  assert.equal(clipSnippet("abcdef", 10), "abcdef");
  assert.equal(clipSnippet("abcdef", 3), "abc");
});

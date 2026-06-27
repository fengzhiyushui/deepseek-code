import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_PROFILES, filterToolSchemas } from "../../../src/core/orchestration/tool-profiles.js";

const ALL = ["read", "ls", "grep", "glob", "test", "diff_preview", "edit", "diff_apply", "diff_rollback", "git", "shell", "memory", "web_fetch"]
  .map((name) => ({ type: "function", function: { name } }));

test("readonly excludes every write/edit/shell tool", () => {
  const names = filterToolSchemas(ALL, "readonly").map((s) => s.function.name);
  for (const forbidden of ["edit", "diff_apply", "diff_rollback", "git", "shell", "memory", "web_fetch"]) {
    assert.equal(names.includes(forbidden), false, `readonly must exclude ${forbidden}`);
  }
  assert.ok(names.includes("read") && names.includes("test"));
});

test("edit includes the edit + diff_apply tools", () => {
  const names = filterToolSchemas(ALL, "edit").map((s) => s.function.name);
  assert.ok(names.includes("edit") && names.includes("diff_apply") && names.includes("git"));
  assert.ok(names.includes("read") && names.includes("test"));
});

test("unknown profile falls back to readonly", () => {
  const names = filterToolSchemas(ALL, "nope").map((s) => s.function.name);
  assert.equal(names.includes("edit"), false);
});

test("TOOL_PROFILES are exported as sets", () => {
  assert.ok(TOOL_PROFILES.readonly instanceof Set);
  assert.ok(TOOL_PROFILES.edit instanceof Set);
});

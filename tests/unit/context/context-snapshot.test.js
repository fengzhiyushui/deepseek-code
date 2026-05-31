import test from "node:test";
import assert from "node:assert/strict";
import { createContextUnit } from "../../../src/context/context-unit.js";
import { buildContextSnapshot } from "../../../src/context/context-snapshot.js";

function unit(path, content, reason = undefined) {
  return createContextUnit({
    path,
    content,
    reason,
    now: "2026-05-31T00:00:00.000Z"
  });
}

test("buildContextSnapshot returns public metadata and compact summary", () => {
  const selected = [
    unit("package.json", "{\"name\":\"demo\"}\n", "project-manifest"),
    unit("src/index.js", "export const demo = true;\n", "mentioned")
  ];

  const snapshot = buildContextSnapshot({
    root: "/repo",
    channel: "act",
    taskType: "edit",
    selected,
    budget: { allocated: 100, used: 20, remaining: 80 },
    stats: { indexed_files: 2, skipped_files: 0 }
  });

  assert.match(snapshot.snapshot_id, /^ctxsnap_/);
  assert.equal(snapshot.root, "/repo");
  assert.equal(snapshot.channel, "act");
  assert.equal(snapshot.task_type, "edit");
  assert.deepEqual(snapshot.units.map((u) => u.path), ["package.json", "src/index.js"]);
  assert.deepEqual(snapshot.assembly_order, ["package.json", "src/index.js"]);
  assert.equal(snapshot.stats.selected_files, 2);
  assert.ok(snapshot.summary.includes("Project files:"));
  assert.ok(snapshot.summary.includes("- package.json (P0 project-manifest)"));
  assert.ok(snapshot.summary.includes("--- src/index.js"));
  assert.equal(snapshot.expected_cache_prefix_offset, selected[0].token_count);
  assert.equal(snapshot.units[0].snippet, undefined);
});

test("buildContextSnapshot handles empty selection", () => {
  const snapshot = buildContextSnapshot({
    root: "/repo",
    channel: "reply",
    taskType: "query",
    selected: [],
    budget: { allocated: 10, used: 0, remaining: 10 },
    stats: { indexed_files: 0, skipped_files: 0 }
  });

  assert.equal(snapshot.summary, "Project files:\n(none selected)");
  assert.deepEqual(snapshot.units, []);
  assert.equal(snapshot.expected_cache_prefix_offset, 0);
});

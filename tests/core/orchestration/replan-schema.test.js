import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReplan, fingerprint } from "../../../src/core/orchestration/subtask-schema.js";

function st(id, deps = [], extra = {}) { return { id, goal: id, acceptance: [], context_scope: { files: [`${id}.js`] }, tool_profile: "edit", depends_on: deps, ...extra }; }
const ctx = (over = {}) => ({ seenSubtaskIds: new Set(["old1"]), completedIds: new Set(["c1"]), failedIds: new Set(["f1"]), ...over });

test("accepts well-formed replan subtasks", () => {
  assert.equal(validateReplan([st("n1"), st("n2", ["n1"])], ctx()).ok, true);
  assert.equal(validateReplan([st("n1", ["c1"])], ctx()).ok, true); // dep on completed OK
});

test("rejects id colliding with a prior round", () => {
  assert.equal(validateReplan([st("old1")], ctx()).ok, false);
});

test("rejects dep on failed unless corrective_for points to it", () => {
  assert.equal(validateReplan([st("n1", ["f1"])], ctx()).ok, false);
  assert.equal(validateReplan([st("n1", ["f1"], { corrective_for: "f1" })], ctx()).ok, true);
  assert.equal(validateReplan([st("n1", ["f1"], { corrective_for: "nope" })], ctx()).ok, false);
});

test("rejects dep on unknown id", () => {
  assert.equal(validateReplan([st("n1", ["ghost"])], ctx()).ok, false);
});

test("fingerprint stable across id renames, sensitive to goal; file order-insensitive", () => {
  assert.equal(fingerprint(st("a")) === fingerprint({ ...st("b"), goal: "a" }), false); // goal a vs b differ
  const x = { id: "x", goal: "do", context_scope: { files: ["b.js", "a.js"] }, tool_profile: "edit" };
  const y = { id: "y", goal: "do", context_scope: { files: ["a.js", "b.js"] }, tool_profile: "edit" };
  assert.equal(fingerprint(x), fingerprint(y));
});

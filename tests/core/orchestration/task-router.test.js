import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskRouter } from "../../../src/core/orchestration/task-router.js";

test("simple messages route to single (zero-regression default)", () => {
  const r = createTaskRouter();
  assert.equal(r.route("what does this function do?").lane, "single");
  assert.equal(r.route("fix the typo in a.js").lane, "single"); // 1 file, no markers
});

test("multiplicity markers route to orchestrate", () => {
  const r = createTaskRouter();
  const d = r.route("给这几个模块分别加输入校验");
  assert.equal(d.lane, "orchestrate");
  assert.ok(d.signals.length > 0);
});

test("multiple file mentions route to orchestrate", () => {
  const r = createTaskRouter({ minComplexFiles: 2 });
  assert.equal(r.route("update a.js and b.js and c.js to use the new api").lane, "orchestrate");
  assert.equal(r.route("update a.js").lane, "single");
});

test("classification is carried through", () => {
  const r = createTaskRouter();
  assert.equal(r.route("explain x").classification.task_type, "query");
});

import test from "node:test";
import assert from "node:assert/strict";
import { derivePanels } from "../../../gui/src/state/panels-derive.js";

test("problems from verification-fail/agent-error/errors; output from stream", () => {
  const { problems, output } = derivePanels([
    { type: "verification:result", pass: false, message: "2 tests failed" },
    { type: "tool:call", tool: "read" },
    { type: "agent:error", message: "boom" }
  ], [{ area: "branches", message: "api down" }]);
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.message === "2 tests failed"));
  assert.ok(problems.some((p) => p.kind === "branches"));
  assert.ok(output.length >= 3);
});

test("empty activity/errors → empty panels", () => {
  assert.deepEqual(derivePanels([], []), { problems: [], output: [] });
});

test("diff_applied output line uses files/summary (real payload)", () => {
  const { output } = derivePanels([
    { type: "file:diff_applied", change_id: "c1", files: ["src/a.js", "src/b.js"] }
  ], []);
  assert.equal(output.length, 1);
  assert.ok(output[0].text.includes("src/a.js"));
  assert.ok(output[0].text.includes("+1"));
});

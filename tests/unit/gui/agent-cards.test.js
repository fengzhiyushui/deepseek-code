import test from "node:test";
import assert from "node:assert/strict";
import { deriveAgentCards } from "../../../gui/src/state/agent-cards.js";

test("plan/tool(pair)/diff/test cards derived from event stream", () => {
  const cards = deriveAgentCards([
    { type: "orchestration:planned", subtasks: 4 },
    { type: "tool:call", id: "t1", tool: "read" },
    { type: "tool:result", id: "t1", status: "ok" },
    { type: "tool:call", id: "t2", tool: "edit" },
    { type: "file:diff_applied", change_id: "chg_1", files: ["src/a.js", "src/b.js"],
      summary: [{ path: "src/a.js", status: "modify" }, { path: "src/b.js", status: "create" }] },
    { type: "verification:result", pass: true }
  ]);
  const byKind = (k) => cards.filter((c) => c.kind === k);
  assert.equal(byKind("plan")[0].subtasks, 4);
  assert.equal(byKind("tool").find((c) => c.id === "t1").status, "ok");
  assert.equal(byKind("tool").find((c) => c.id === "t2").status, "running");
  assert.equal(byKind("diff")[0].path, "src/a.js");
  assert.equal(byKind("diff")[0].fileCount, 2);
  assert.equal(byKind("diff")[0].changeId, "chg_1");
  assert.equal(byKind("diff")[0].applied, true);
  assert.equal(byKind("test")[0].pass, true);
});

test("diff_preview without change_id → changeId null, summary fallback for paths", () => {
  const [card] = deriveAgentCards([
    { type: "file:diff_preview", summary: [{ path: "src/x.js", status: "modify" }] }
  ]);
  assert.equal(card.kind, "diff");
  assert.equal(card.changeId, null);
  assert.equal(card.path, "src/x.js");
  assert.equal(card.fileCount, 1);
  assert.equal(card.applied, false);
});

test("tool:result error marks the tool card as error", () => {
  const cards = deriveAgentCards([
    { type: "tool:call", id: "x", tool: "shell" },
    { type: "tool:result", id: "x", status: "error" }
  ]);
  assert.equal(cards[0].status, "error");
});

test("empty activity → no cards", () => {
  assert.deepEqual(deriveAgentCards([]), []);
  assert.deepEqual(deriveAgentCards(null), []);
});

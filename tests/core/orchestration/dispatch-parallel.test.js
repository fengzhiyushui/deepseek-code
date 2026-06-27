import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatchLoop } from "../../../src/core/orchestration/dispatch-loop.js";
import { toBatches } from "../../../src/core/orchestration/batch-planner.js";

function st(id, files, deps = []) { return { id, goal: id, acceptance: [], context_scope: { files }, tool_profile: "edit", depends_on: deps }; }
const noBudget = { exceeded: () => null };
const synth = { synthesize: async ({ collected }) => `synth:${collected.map((c) => `${c.st.id}=${c.status}`).join(",")}` };

test("parallel batch: disjoint subtasks merge; one out-of-scope fails; no residue", async () => {
  const removed = [];
  const plan = { subtasks: [st("a", ["a.js"]), st("b", ["b.js"])] };
  const runIsolatedWorker = async ({ subtask }) => ({
    st: subtask,
    wres: { status: "complete", content: `did ${subtask.id}` },
    verdict: { pass: true, severity: "warn", reasons: [], checked: [] },
    actual: subtask.id === "b"
      ? { added: [], modified: ["unscoped.js"], deleted: [] }   // b writes out of scope!
      : { added: [], modified: ["a.js"], deleted: [] },
    isoRoot: `/iso/${subtask.id}`
  });
  const mergeSubtask = async ({ isoRoot }) => ({ ok: true, change_id: `chg_${isoRoot}` });
  const removeIso = async (dir) => { removed.push(dir); return true; };

  const r = await runDispatchLoop({
    plan, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "auto",
    toBatches, maxParallelWorkers: 4, runIsolatedWorker, mergeSubtask, removeIso
  });
  assert.equal(r.status, "complete");
  assert.match(r.content, /a=complete/);
  assert.match(r.content, /b=failed/);                  // out-of-scope -> failed
  assert.deepEqual(removed.sort(), ["/iso/a", "/iso/b"]); // both iso dirs cleaned (zero residue)
});

test("iso dir removed even when the isolated worker throws (zero residue)", async () => {
  const removed = [];
  const plan = { subtasks: [st("a", ["a.js"]), st("b", ["b.js"])] };
  const runIsolatedWorker = async ({ subtask }) => {
    if (subtask.id === "b") return { st: subtask, error: new Error("boom"), isoRoot: "/iso/b" };
    return { st: subtask, wres: { status: "complete", content: "ok" }, verdict: { pass: true, severity: "warn", reasons: [], checked: [] }, actual: { added: [], modified: ["a.js"], deleted: [] }, isoRoot: "/iso/a" };
  };
  const r = await runDispatchLoop({
    plan, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "auto",
    toBatches, maxParallelWorkers: 4, runIsolatedWorker, mergeSubtask: async () => ({ ok: true }), removeIso: async (d) => { removed.push(d); return true; }
  });
  assert.match(r.content, /a=complete/);
  assert.match(r.content, /b=failed/);
  assert.deepEqual(removed.sort(), ["/iso/a", "/iso/b"]);
});

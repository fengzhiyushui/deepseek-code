import test from "node:test";
import assert from "node:assert/strict";
import { QUIET, eventToLines } from "../../../src/apps/tui/event-cards.js";
import { makeT } from "../../../src/apps/tui/tui-i18n.js";

const t = makeT("zh");
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
const flat = (ev) => eventToLines(ev, t).map(strip).join("\n");

test("noisy events are quiet", () => {
  for (const type of ["model:request", "model:response", "agent:step", "agent:turn_started", "user:message", "agent:final", "agent:error"]) {
    assert.ok(QUIET.has(type), type);
  }
});

test("tool call/result render as paired lines", () => {
  assert.match(flat({ type: "tool:call", call: { name: "edit", args: { path: "src/a.js" } } }), /┌ tool ▸ edit.*src\/a\.js/);
  assert.match(flat({ type: "tool:result", result: { status: "ok" } }), /└ ok/);
  assert.match(flat({ type: "tool:result", result: { status: "error" } }), /└ error/);
});

test("diff applied renders per-file card", () => {
  const out = flat({
    type: "file:diff_applied",
    change_id: "chg_1",
    files: [{ path: "src/a.js", status: "M", added: 2, removed: 1 }]
  });
  assert.match(out, /┌─ diff · chg_1/);
  assert.match(out, /│ M src\/a\.js \+2 −1/);
  assert.match(out, /└─/);
});

test("diff applied falls back to summary array and unknown counts", () => {
  const out = flat({ type: "file:diff_applied", change_id: "chg_2", summary: [{ path: "b.js" }] });
  assert.match(out, /│ M b\.js/);
  assert.doesNotMatch(out, /undefined|NaN/);
});

test("approval request renders summary card", () => {
  const out = flat({ type: "approval:requested", approval: { id: "ap_1", summary: "write src/a.js" } });
  assert.match(out, /需要审批/);
  assert.match(out, /write src\/a\.js/);
});

test("misc one-liners", () => {
  assert.match(flat({ type: "file:rollback_applied", change_id: "chg_1" }), /已回退 chg_1/);
  assert.match(flat({ type: "verification:result", result: { status: "pass" } }), /验证 pass/);
  assert.match(flat({ type: "orchestration:route_resolved", lane: "single" }), /路由 ▸ single/);
  assert.match(flat({ type: "orchestration:worker_started", worker: "w1" }), /orch ▸ worker_started/);
  assert.match(flat({ type: "recovery:blocked", reason: "orphan", item_id: "x1" }), /恢复 blocked orphan x1/);
  assert.match(flat({ type: "some:new_thing" }), /· some:new_thing/);
});

test("orchestration subtask start/review render distinct cards", () => {
  assert.match(flat({ type: "orchestration:subtask_started", subtask_id: "s1", attempt: 1, tool_profile: "edit" }), /子任务 s1/);
  assert.match(flat({ type: "orchestration:subtask_reviewed", subtask_id: "s1", pass: true }), /审核.*通过/);
  assert.match(flat({ type: "orchestration:subtask_reviewed", subtask_id: "s1", pass: false, severity: "high" }), /审核.*未通过/);
});

test("existing orchestration one-liners still render (planned/replanned)", () => {
  assert.match(flat({ type: "orchestration:planned", subtasks: 3 }), /orch|plan|子任务|round|3/);
});

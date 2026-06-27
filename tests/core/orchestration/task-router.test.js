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

// ── C-Router 分层(模型档)──
const AMBIG = "把这些逻辑整理一下";                       // 弱 "这些" → score 1 → ambiguous
const SIMPLE = "hello";                                   // score 0
const COMPLEX = "重构整个项目并迁移到新框架";              // 强×2 → score 4
const LONG_EDIT = "Please refactor and clean up the authentication module thoroughly and add input validation everywhere now";

test("bare construct (no callModel) stays heuristic = today", () => {
  const r = createTaskRouter();
  assert.equal(r.route(LONG_EDIT).lane, "single");        // long-edit catcher NOT in signals
  assert.equal(r.route(AMBIG).lane, "orchestrate");       // weak marker is a today-signal
});

test("disabled: long-edit catcher does not change today's lane", () => {
  const r = createTaskRouter({ model: { enabled: false } });
  const d = r.route(LONG_EDIT);                            // sync (heuristic)
  assert.equal(d.lane, "single");
  assert.equal(d.tier, "heuristic");
});

test("enabled: simple/complex short-circuit with no model call", async () => {
  let calls = 0;
  const callModel = async () => { calls += 1; return '{"lane":"orchestrate"}'; };
  const r = createTaskRouter({ model: { enabled: true, callModel, complexThreshold: 3 } });
  assert.equal((await r.route(SIMPLE)).lane, "single");
  assert.equal((await r.route(COMPLEX)).lane, "orchestrate");
  assert.equal(calls, 0);                                  // confident bands are free
});

test("enabled: ambiguous consults model once, takes its lane", async () => {
  let calls = 0;
  const callModel = async () => { calls += 1; return '{"lane":"orchestrate","reason":"multi"}'; };
  const r = createTaskRouter({ model: { enabled: true, callModel, complexThreshold: 3 } });
  const d = await r.route(AMBIG);
  assert.equal(calls, 1);
  assert.equal(d.lane, "orchestrate");
  assert.equal(d.tier, "model");
});

test("narrowness fix: keyword-less long edit routes via model", async () => {
  const callModel = async () => '{"lane":"orchestrate","reason":"big refactor"}';
  const r = createTaskRouter({ model: { enabled: true, callModel, complexThreshold: 3 } });
  const d = await r.route(LONG_EDIT);
  assert.equal(d.band, "ambiguous");
  assert.equal(d.lane, "orchestrate");
});

test("malformed output retries then falls back (total calls <= maxRepairs+1)", async () => {
  let calls = 0;
  const callModel = async () => { calls += 1; return "not json"; };
  const r = createTaskRouter({ model: { enabled: true, callModel, maxRepairs: 1, complexThreshold: 3 }, now: () => 0 });
  const d = await r.route(AMBIG);
  assert.equal(calls, 2);                                  // maxRepairs+1
  assert.equal(d.tier, "fallback");
  assert.equal(d.reason, "router_model_invalid");
  assert.equal(d.lane, "orchestrate");                     // signals(weak marker)>0 → fallback orchestrate
});

test("maxRepairs=0 ⇒ total calls <= 1", async () => {
  let calls = 0;
  const callModel = async () => { calls += 1; return "garbage"; };
  const r = createTaskRouter({ model: { enabled: true, callModel, maxRepairs: 0, complexThreshold: 3 }, now: () => 0 });
  await r.route(AMBIG);
  assert.equal(calls, 1);
});

test("total timeout across retries → router_model_timeout fallback", async () => {
  let t = 1000, calls = 0;
  const now = () => t;
  const callModel = async () => { calls += 1; t += 5000; return "not json"; };  // each attempt burns 5s
  const r = createTaskRouter({ model: { enabled: true, callModel, timeoutMs: 8000, maxRepairs: 5, complexThreshold: 3 }, now });
  const d = await r.route(AMBIG);
  assert.equal(d.reason, "router_model_timeout");
  assert.equal(calls, 2);                                  // 3rd attempt short-circuits on remaining<=0
});

test("empty gateway and thrown error both fall back", async () => {
  const empty = createTaskRouter({ model: { enabled: true, callModel: async () => "", complexThreshold: 3 }, now: () => 0 });
  assert.equal((await empty.route(AMBIG)).reason, "router_model_empty");
  const thrown = createTaskRouter({ model: { enabled: true, callModel: async () => { throw new Error("boom"); }, complexThreshold: 3 }, now: () => 0 });
  assert.equal((await thrown.route(AMBIG)).reason, "router_model_error");
});

test("invalid verdict lane is rejected (treated as malformed)", async () => {
  let calls = 0;
  const callModel = async () => { calls += 1; return '{"lane":"banana"}'; };
  const r = createTaskRouter({ model: { enabled: true, callModel, maxRepairs: 0, complexThreshold: 3 }, now: () => 0 });
  const d = await r.route(AMBIG);
  assert.equal(d.tier, "fallback");
  assert.equal(d.reason, "router_model_invalid");
});

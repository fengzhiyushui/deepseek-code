import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewer } from "../../../src/core/orchestration/reviewer.js";

function runtimeReturning(content) { return { send: async () => ({ status: "complete", content }) }; }

test("parses a valid verdict from runtime output", async () => {
  const r = createReviewer({ runtime: runtimeReturning('{"pass":true,"severity":"warn","reasons":[],"checked":["ran tests"]}') });
  const v = await r.review({ id: "st_1", acceptance: ["x"] }, { content: "did the thing" });
  assert.equal(v.pass, true);
});

test("unparseable output -> conservative warn fail", async () => {
  const r = createReviewer({ runtime: runtimeReturning("looks fine to me, no JSON here") });
  const v = await r.review({ id: "st_1", acceptance: ["x"] }, { content: "x" });
  assert.equal(v.pass, false);
  assert.equal(v.severity, "warn");
});

test("extracts JSON embedded in prose", async () => {
  const r = createReviewer({ runtime: runtimeReturning('Verdict: {"pass":false,"severity":"block","reasons":["missing test"],"checked":["read diff"]} done') });
  const v = await r.review({ id: "st_1", acceptance: ["x"] }, { content: "x" });
  assert.equal(v.pass, false);
  assert.deepEqual(v.reasons, ["missing test"]);
});

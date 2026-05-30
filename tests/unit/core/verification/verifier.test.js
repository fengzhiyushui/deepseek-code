import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldVerifyToolResults,
  runVerifier
} from "../../../../src/core/verification/verifier.js";
import { decideRepair } from "../../../../src/core/verification/repair-decision.js";

test("shouldVerifyToolResults detects successful edit-like tools", () => {
  assert.equal(shouldVerifyToolResults([
    { status: "success", metadata: { change_id: "c1" } }
  ]), true);
  assert.equal(shouldVerifyToolResults([
    { status: "success", metadata: { path: "README.md" } }
  ]), false);
});

test("runVerifier executes detect-only test tool when edits occurred", async () => {
  const calls = [];
  const result = await runVerifier({
    turnId: "turn_1",
    toolResults: [{ status: "success", metadata: { change_id: "c1" } }],
    executeTool: async (toolCall) => {
      calls.push(toolCall);
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: "Detected: npm test" }], metadata: { argv: ["npm", "test"] } };
    },
    createPolicyContext: () => ({ autonomy: "gated" })
  });

  assert.equal(result.status, "passed");
  assert.equal(calls[0].name, "test");
  assert.deepEqual(calls[0].params, { detect: true });
});

test("runVerifier skips when there are no edit results", async () => {
  const result = await runVerifier({
    turnId: "turn_1",
    toolResults: [],
    executeTool: async () => { throw new Error("should not run"); },
    createPolicyContext: () => ({})
  });

  assert.equal(result.status, "skipped");
});

test("decideRepair asks for repair on failed verification and stops on approval", () => {
  assert.equal(decideRepair({ status: "failed" }).decision, "repair");
  assert.equal(decideRepair({ status: "approval_required" }).decision, "stop");
  assert.equal(decideRepair({ status: "passed" }).decision, "none");
});

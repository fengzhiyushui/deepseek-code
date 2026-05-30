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
    autonomy: "supervised",
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

test("runVerifier treats non-zero test exit code as failed", async () => {
  const result = await runVerifier({
    turnId: "turn_fail",
    toolResults: [{ status: "success", metadata: { change_id: "chg_1" } }],
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    executeTool: async () => ({
      call_id: "call_test",
      status: "success",
      content: [{ type: "text", text: "failing tests" }],
      metadata: { exit_code: 2, argv: ["npm", "test"] }
    }),
    createPolicyContext: () => ({ autonomy: "auto" })
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exit_code, 2);
  assert.match(result.reason, /failing tests/);
});

test("runVerifier uses verification policy test params", async () => {
  const calls = [];
  const result = await runVerifier({
    turnId: "turn_policy",
    toolResults: [{ status: "success", metadata: { change_id: "chg_1" } }],
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false, argv: ["node", "--test"] }, mode: "run" }) },
    executeTool: async (toolCall) => {
      calls.push(toolCall);
      return {
        call_id: toolCall.id,
        status: "success",
        content: [{ type: "text", text: "ok" }],
        metadata: { exit_code: 0 }
      };
    },
    createPolicyContext: () => ({ autonomy: "auto" })
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(calls[0].params, { detect: false, argv: ["node", "--test"] });
});

test("runVerifier passes caller autonomy to verification policy", async () => {
  let observedAutonomy = null;
  const result = await runVerifier({
    turnId: "turn_autonomy",
    autonomy: "supervised",
    toolResults: [{ status: "success", metadata: { change_id: "chg_1" } }],
    verificationPolicy: {
      plan: ({ autonomy }) => {
        observedAutonomy = autonomy;
        return { shouldVerify: false, reason: "observed", mode: "detect" };
      }
    },
    executeTool: async () => { throw new Error("should not execute test tool"); },
    createPolicyContext: () => ({ autonomy: "auto" })
  });

  assert.equal(observedAutonomy, "supervised");
  assert.deepEqual(result, { status: "skipped", reason: "observed", mode: "detect" });
});

test("runVerifier can skip through verification policy", async () => {
  const result = await runVerifier({
    turnId: "turn_skip_policy",
    toolResults: [{ status: "success", metadata: { change_id: "chg_1" } }],
    verificationPolicy: { plan: () => ({ shouldVerify: false, reason: "verification disabled", mode: "off" }) },
    executeTool: async () => { throw new Error("should not execute test tool"); },
    createPolicyContext: () => ({ autonomy: "auto" })
  });

  assert.deepEqual(result, { status: "skipped", reason: "verification disabled", mode: "off" });
});

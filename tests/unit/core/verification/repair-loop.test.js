import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../../src/shared/event-bus.js";
import { runRepairLoop } from "../../../../src/core/verification/repair-loop.js";

test("repair loop repairs failed verification and returns complete when verification passes", async () => {
  const bus = createEventBus();
  const events = [];
  for (const type of ["repair:started", "repair:attempt", "repair:result"]) {
    bus.subscribe(type, (data) => events.push([type, data]));
  }
  let verifierCalls = 0;
  const result = await runRepairLoop({
    turnId: "turn_repair",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => ({ content: "", tool_calls: [{ id: "call_edit", name: "edit", arguments: { diff: "d" } }] })
    },
    toolSchemas: [],
    executeTool: async (toolCall) => ({ call_id: toolCall.id, status: "success", content: [{ type: "text", text: "applied" }], metadata: { change_id: "chg_2" } }),
    createPolicyContext: () => ({ autonomy: "gated" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    runVerifierImpl: async () => {
      verifierCalls += 1;
      return { status: "passed", reason: "ok" };
    },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [{ call_id: "call_old", status: "success", content: [], metadata: { change_id: "chg_1" } }],
    eventBus: bus,
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "complete");
  assert.equal(verifierCalls, 1);
  assert.ok(events.some(([type]) => type === "repair:started"));
  assert.ok(events.some(([type]) => type === "repair:attempt"));
  assert.ok(events.some(([type]) => type === "repair:result"));
});

test("repair loop stops on approval_required", async () => {
  const result = await runRepairLoop({
    turnId: "turn_repair_approval",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => ({ content: "", tool_calls: [{ id: "call_shell", name: "shell", arguments: { argv: ["npm", "test"] } }] })
    },
    toolSchemas: [],
    executeTool: async (toolCall) => ({
      call_id: toolCall.id,
      status: "approval_required",
      content: [{ type: "text", text: "approval" }],
      metadata: { approval: { id: "approval_repair" } }
    }),
    createPolicyContext: () => ({ autonomy: "supervised" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [],
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.approval.id, "approval_repair");
});

test("repair loop exhausts max attempts", async () => {
  const bus = createEventBus();
  const exhausted = [];
  bus.subscribe("repair:exhausted", (data) => exhausted.push(data));
  let verifierCalls = 0;
  const result = await runRepairLoop({
    turnId: "turn_exhaust",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => ({ content: "no repair", tool_calls: [] })
    },
    toolSchemas: [],
    executeTool: async () => { throw new Error("should not execute"); },
    createPolicyContext: () => ({ autonomy: "gated" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    runVerifierImpl: async () => {
      verifierCalls += 1;
      return { status: "failed", reason: `still failing ${verifierCalls}` };
    },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [],
    eventBus: bus,
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "failed");
  assert.equal(result.repair.attempts, 2);
  assert.equal(exhausted.length, 1);
});

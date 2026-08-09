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

test("repair loop saves repair context on pause for approval resume", async () => {
  const result = await runRepairLoop({
    turnId: "turn_repair_ctx",
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
      metadata: { approval: { id: "approval_repair_ctx" } }
    }),
    createPolicyContext: () => ({ autonomy: "supervised" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [{ call_id: "call_orig", status: "success", content: [], metadata: { change_id: "chg_1" } }],
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "awaiting_approval");
  const ctx = result.resume_state?.repair_context;
  assert.ok(ctx, "should save repair context in resume_state");
  assert.equal(ctx.attempt, 1);
  assert.equal(ctx.max_repair_attempts, 2);
  assert.equal(ctx.verification.status, "failed");
  assert.equal(ctx.all_tool_results.length, 1);
  assert.equal(ctx.all_tool_results[0].metadata.change_id, "chg_1");
  assert.equal(ctx.initial_verification.status, "failed");
});

test("repair loop passes context into repair messages", async () => {
  let receivedMessages = null;
  const result = await runRepairLoop({
    turnId: "turn_repair_context",
    userMessage: "modify a.txt",
    classification: { task_type: "edit" },
    modelGateway: {},
    toolSchemas: [],
    executeTool: async () => { throw new Error("no tools expected"); },
    createPolicyContext: () => ({}),
    verificationPolicy: { plan: () => ({ shouldVerify: false, mode: "off" }) },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [],
    context: { snapshot_id: "ctxsnap_repair", summary: "Project files:\n- a.txt" },
    maxRepairAttempts: 1,
    runRepairExecutorImpl: async ({ messages }) => {
      receivedMessages = messages;
      return { status: "complete", content: "no fix", toolResults: [] };
    },
    runVerifierImpl: async () => ({ status: "skipped", reason: "off" })
  });

  assert.equal(result.status, "complete");
  const payload = JSON.parse(receivedMessages[1].content);
  assert.equal(payload.context_summary.includes("a.txt"), true);
});

test("repair loop resumeAfterApproval verifies with original + resumed results then exhausts", async () => {
  // Simulate: repair paused for shell, shell approved and executed,
  // now resume repair loop. Verifier should see original edit + shell results.
  const bus = createEventBus();
  const exhausted = [];
  bus.subscribe("repair:exhausted", (data) => exhausted.push(data));
  let verifierToolResults = null;

  const result = await runRepairLoop({
    turnId: "turn_resume_after",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => ({ content: "no more repair", tool_calls: [] })
    },
    executeTool: async () => { throw new Error("should not execute"); },
    createPolicyContext: () => ({ autonomy: "gated" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    runVerifierImpl: async ({ toolResults }) => {
      verifierToolResults = toolResults;
      // No new edit happened — should still fail
      return { status: "failed", reason: "still failing" };
    },
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [{ call_id: "call_orig", status: "success", content: [], metadata: { change_id: "chg_1" } }],
    maxRepairAttempts: 1,
    eventBus: bus,
    resumeAfterApproval: {
      all_tool_results: [
        { call_id: "call_orig", status: "success", content: [], metadata: { change_id: "chg_1" } },
        { call_id: "call_shell", status: "success", content: [{ type: "text", text: "ran" }] }
      ],
      verification: { status: "failed", reason: "tests failed" },
      attempt: 1,
      attempts: [],
      initial_verification: { status: "failed", reason: "tests failed" }
    }
  });

  // Verifier should have seen BOTH the original edit AND the shell result
  assert.ok(verifierToolResults, "verifier should have been called");
  assert.ok(verifierToolResults.some(r => r.metadata?.change_id === "chg_1"), "original edit results must be present");
  assert.ok(verifierToolResults.some(r => r.call_id === "call_shell"), "resumed shell result must be present");
  // No repair edit happened, verifier still fails, 1 attempt exhausted
  assert.equal(result.status, "failed");
  assert.equal(result.repair.attempts, 1);
  assert.equal(exhausted.length, 1);
});

test("repair loop without budget is unchanged (repair proceeds as before)", async () => {
  let invokeCount = 0;
  const result = await runRepairLoop({
    turnId: "turn_repair_null_budget",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => {
        invokeCount += 1;
        return { content: "repaired", tool_calls: [], usage: { total_tokens: 10 } };
      }
    },
    toolSchemas: [],
    executeTool: async () => ({ call_id: "c", status: "success", content: [], metadata: { change_id: "chg" } }),
    createPolicyContext: () => ({ autonomy: "gated" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    runVerifierImpl: async () => ({ status: "passed", reason: "ok" }),
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [],
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "complete");
  assert.equal(invokeCount, 1, "不传 budget 时 repair 照常发起模型调用(逐字节不变)");
});

test("repair loop with an already-exceeded budget stops before any model call", async () => {
  let invokeCount = 0;
  const exceededBudget = {
    exceeded: () => ({ reason: "max_model_calls" }),
    snapshot: () => ({ tokens: 100, model_calls: 5 })
  };
  const result = await runRepairLoop({
    turnId: "turn_repair_exceeded",
    userMessage: "fix bug",
    classification: { task_type: "edit" },
    modelGateway: {
      invoke: async () => {
        invokeCount += 1;
        return { content: "", tool_calls: [] };
      }
    },
    toolSchemas: [],
    executeTool: async () => ({ call_id: "c", status: "success", content: [], metadata: { change_id: "chg" } }),
    createPolicyContext: () => ({ autonomy: "gated" }),
    verificationPolicy: { plan: () => ({ shouldVerify: true, testParams: { detect: false }, mode: "run" }) },
    runVerifierImpl: async () => ({ status: "passed", reason: "ok" }),
    initialVerification: { status: "failed", reason: "tests failed" },
    initialToolResults: [],
    maxRepairAttempts: 2,
    budget: exceededBudget
  });

  assert.equal(result.status, "stopped");
  assert.equal(invokeCount, 0, "预算已耗尽时 repair 不应再调模型");
});

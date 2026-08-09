import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../../src/shared/event-bus.js";
import { SESSION_EVENT_TYPES } from "../../../../src/sessions/event-types.js";
import { createAgentRuntime } from "../../../../src/core/runtime/agent-runtime.js";

// #10 阶段 1 · 行为刻画测试(characterization)
// 目的:把 agent-runtime 当前的真实行为钉死(事件发布顺序、错误语义、四条
// 审批恢复分支的续跑语义)。这些断言来自对当前实现的探测输出,不是理想值。
// 验收标准:本文件全部通过 ≠ 完成 —— 必须额外做「变异验证」:故意改坏实现
// 任一处,至少一条本文件用例变红;若改坏仍全绿,说明没刻画到,退回重写。
// 注意:tool:call/tool:result 由 executor 层发布,本文件注入裸 executeTool
// 不经 executor,故序列里不含它们 —— 序列锁的是 runtime 自己发布的事件。

function recorder() {
  const events = [];
  const bus = createEventBus();
  for (const type of SESSION_EVENT_TYPES) {
    bus.subscribe(type, () => events.push(type));
  }
  return { bus, events };
}

// ── 场景 1:完整 send 回合(edit 成功 → verify pass → final)的事件顺序 ──
test("characterization: full edit-verify turn publishes events in exact order", async () => {
  const { bus, events } = recorder();
  let n = 0;
  const runtime = createAgentRuntime({
    sessionId: "char_s1", eventBus: bus, verifyMode: "run",
    modelGateway: {
      invoke: async () => {
        n += 1;
        return n === 1
          ? { content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }
          : { content: "ok", tool_calls: [] };
      },
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async (tc) => tc.name === "test"
      ? { call_id: tc.id, status: "success", content: [{ type: "text", text: "pass" }], metadata: { exit_code: 0 } }
      : { call_id: tc.id, status: "success", content: [], metadata: { change_id: "chg1" } },
    createPolicyContext: () => ({ autonomy: "gated" })
  });

  const r = await runtime.send("modify", { autonomy: "auto", verifyMode: "run" });
  assert.equal(r.status, "complete");
  assert.deepEqual(events, [
    "user:message", "agent:turn_started", "agent:step",
    "model:request", "model:response",
    "model:request", "model:response",
    "verification:result", "agent:final"
  ]);
});

// ── 分支 1:普通工具审批 → approve 续跑的事件顺序 ──
test("characterization: ordinary tool approval resume publishes events in exact order", async () => {
  const { bus, events } = recorder();
  let approved = false, n = 0;
  const runtime = createAgentRuntime({
    sessionId: "char_s2", eventBus: bus,
    modelGateway: {
      invoke: async () => {
        n += 1;
        return n === 1
          ? { content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }
          : { content: "done", tool_calls: [] };
      },
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async (tc) => {
      if (tc.name === "test") return { call_id: tc.id, status: "success", content: [], metadata: { exit_code: 0 } };
      if (!approved) return { call_id: tc.id, status: "approval_required", content: [], metadata: { approval: { id: "ap1" } } };
      return { call_id: tc.id, status: "success", content: [], metadata: { change_id: "chg1" } };
    },
    createPolicyContext: () => ({ autonomy: "gated" }),
    grantApprovalForToolCall: async () => { approved = true; }
  });

  const first = await runtime.send("modify", { autonomy: "supervised" });
  assert.equal(first.status, "awaiting_approval");
  const resumed = await runtime.approve("ap1", "approve");
  assert.equal(resumed.status, "complete");
  assert.deepEqual(events, [
    "user:message", "agent:turn_started", "agent:step",
    "model:request", "model:response",
    "turn:paused", "approval:resolved", "turn:resumed",
    "model:request", "model:response",
    "verification:result", "agent:final"
  ]);
});

// ── 分支 2:主验证器审批(验证器的 test 工具要求审批)→ approve 续跑 ──
test("characterization: runtime verifier approval resume re-runs verifier then completes", async () => {
  const { bus, events } = recorder();
  let approveVerifier = false, mainN = 0;
  const runtime = createAgentRuntime({
    sessionId: "char_s3", eventBus: bus, maxRepairAttempts: 2, verifyMode: "run",
    modelGateway: {
      invoke: async (_m, opts = {}) => {
        if (opts.purpose === "repair") return { content: "", tool_calls: [] };
        mainN += 1;
        return mainN === 1
          ? { content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }
          : { content: "done", tool_calls: [] };
      },
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async (tc) => {
      if (tc.name === "test") {
        if (!approveVerifier) {
          approveVerifier = true;
          return { call_id: tc.id, status: "approval_required", content: [{ type: "text", text: "verifier needs ok" }], metadata: { approval: { id: "ap_v" } } };
        }
        return { call_id: tc.id, status: "success", content: [], metadata: { exit_code: 0 } };
      }
      return { call_id: tc.id, status: "success", content: [], metadata: { change_id: "chg1" } };
    },
    createPolicyContext: () => ({ autonomy: "supervised" }),
    grantApprovalForToolCall: async () => {}
  });

  const first = await runtime.send("modify", { autonomy: "supervised" });
  assert.equal(first.status, "awaiting_approval");
  assert.equal(first.approval.id, "ap_v");
  const resumed = await runtime.approve("ap_v", "approve");
  assert.equal(resumed.status, "complete");
  assert.deepEqual(events, [
    "user:message", "agent:turn_started", "agent:step",
    "model:request", "model:response",
    "model:request", "model:response",
    "verification:result",
    "turn:paused", "approval:resolved", "turn:resumed",
    "verification:result", "agent:final"
  ]);
});

// ── 分支 3:修复期工具审批(repair 的 shell 要求审批)→ 续跑继续 repair 循环 ──
test("characterization: repair tool approval resume continues the repair loop then errors", async () => {
  const { bus, events } = recorder();
  let shellApproved = false, mainN = 0, repairN = 0;
  const runtime = createAgentRuntime({
    sessionId: "char_s4", eventBus: bus, maxRepairAttempts: 2, verifyMode: "run",
    modelGateway: {
      invoke: async (_m, opts = {}) => {
        if (opts.purpose === "repair") {
          repairN += 1;
          return repairN === 1
            ? { content: "", tool_calls: [{ id: "c9", name: "shell", arguments: {} }] }
            : { content: "no fix needed", tool_calls: [] };
        }
        mainN += 1;
        return mainN === 1
          ? { content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }
          : { content: "done", tool_calls: [] };
      },
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async (tc) => {
      if (tc.name === "test") return { call_id: tc.id, status: "success", content: [{ type: "text", text: "fail" }], metadata: { exit_code: 1 } };
      if (tc.name === "shell") {
        if (!shellApproved) return { call_id: tc.id, status: "approval_required", content: [], metadata: { approval: { id: "ap_shell" } } };
        return { call_id: tc.id, status: "success", content: [], metadata: {} };
      }
      return { call_id: tc.id, status: "success", content: [], metadata: { change_id: "chg1" } };
    },
    createPolicyContext: () => ({ autonomy: "supervised" }),
    grantApprovalForToolCall: async () => { shellApproved = true; }
  });

  const first = await runtime.send("modify", { autonomy: "supervised" });
  assert.equal(first.status, "awaiting_approval");
  assert.equal(first.approval.id, "ap_shell");
  // 续跑会继续 repair 循环;修复始终不生效 → 尝试耗尽 → approve 抛 verification failed
  await assert.rejects(
    () => runtime.approve("ap_shell", "approve"),
    /verification failed/
  );
  assert.deepEqual(events, [
    "user:message", "agent:turn_started", "agent:step",
    "model:request", "model:response",
    "model:request", "model:response",
    "verification:result",
    "repair:started", "repair:attempt",
    "model:request", "model:response",
    "turn:paused", "approval:resolved", "turn:resumed",
    "model:request", "model:response",
    "verification:result", "repair:result",
    "repair:attempt", "model:request", "model:response",
    "verification:result", "repair:result",
    "repair:exhausted", "agent:error"
  ]);
});

// ── 分支 4:修复期验证器审批 → 续跑重跑 verifier、记 repair:result 后完成 ──
test("characterization: repair verifier approval resume re-runs verifier and completes", async () => {
  const { bus, events } = recorder();
  let testCalls = 0, mainN = 0;
  const runtime = createAgentRuntime({
    sessionId: "char_s5", eventBus: bus, maxRepairAttempts: 2, verifyMode: "run",
    modelGateway: {
      invoke: async (_m, opts = {}) => {
        if (opts.purpose === "repair") return { content: "no fix", tool_calls: [] };
        mainN += 1;
        return mainN === 1
          ? { content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }
          : { content: "done", tool_calls: [] };
      },
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async (tc) => {
      if (tc.name === "test") {
        testCalls += 1;
        if (testCalls === 1) return { call_id: tc.id, status: "success", content: [{ type: "text", text: "main verify fail" }], metadata: { exit_code: 1 } };
        if (testCalls === 2) return { call_id: tc.id, status: "approval_required", content: [{ type: "text", text: "repair verifier needs ok" }], metadata: { approval: { id: "ap_rv" } } };
        return { call_id: tc.id, status: "success", content: [], metadata: { exit_code: 0 } };
      }
      return { call_id: tc.id, status: "success", content: [], metadata: { change_id: "chg1" } };
    },
    createPolicyContext: () => ({ autonomy: "supervised" }),
    grantApprovalForToolCall: async () => {}
  });

  const first = await runtime.send("modify", { autonomy: "supervised" });
  assert.equal(first.status, "awaiting_approval");
  assert.equal(first.approval.id, "ap_rv");
  const resumed = await runtime.approve("ap_rv", "approve");
  assert.equal(resumed.status, "complete");
  assert.deepEqual(events, [
    "user:message", "agent:turn_started", "agent:step",
    "model:request", "model:response",
    "model:request", "model:response",
    "verification:result",
    "repair:started", "repair:attempt",
    "model:request", "model:response",
    "verification:result",
    "turn:paused", "approval:resolved", "turn:resumed",
    "verification:result", "repair:result", "agent:final"
  ]);
});

// ── 错误语义:未知审批 id 的 code 与 message ──
test("characterization: approve with unknown id throws APPROVAL_NOT_FOUND with exact message", async () => {
  const runtime = createAgentRuntime({ sessionId: "char_err1" });
  await assert.rejects(
    () => runtime.approve("missing", "approve"),
    (e) => e.code === "APPROVAL_NOT_FOUND" && e.message === "approval not found: missing"
  );
});

// ── 错误语义:审批暂停时新 send 的 code 与 message ──
test("characterization: send while approval paused throws AWAITING_APPROVAL with exact message", async () => {
  const runtime = createAgentRuntime({
    sessionId: "char_err2",
    modelGateway: {
      invoke: async () => ({ content: "", tool_calls: [{ id: "c1", name: "edit", arguments: {} }] }),
      reply: async () => ({ content: "fast" })
    },
    toolSchemas: () => [],
    executeTool: async () => ({ call_id: "c1", status: "approval_required", content: [], metadata: { approval: { id: "ap1" } } }),
    createPolicyContext: () => ({ autonomy: "supervised" })
  });
  await runtime.send("modify", { autonomy: "supervised" });
  await assert.rejects(
    () => runtime.send("again", { autonomy: "supervised" }),
    (e) => e.code === "AWAITING_APPROVAL" && e.message === "approval is awaiting resolution"
  );
});

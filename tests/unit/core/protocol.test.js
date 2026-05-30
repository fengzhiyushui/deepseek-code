import test from "node:test";
import assert from "node:assert/strict";
import {
  createAgentTurn,
  setTurnStatus,
  addTurnStep,
  createAgentStep,
  completeAgentStep,
  createToolCall,
  createToolResult,
  createApprovalRequest,
  createArtifact
} from "../../../src/core/protocol/index.js";

test("createAgentTurn builds a valid turn", () => {
  const turn = createAgentTurn({
    sessionId: "sess_1",
    userMessage: "hello",
    autonomy: "gated"
  });

  assert.ok(turn.id.startsWith("turn_"));
  assert.equal(turn.session_id, "sess_1");
  assert.equal(turn.user_message, "hello");
  assert.equal(turn.status, "running");
  assert.equal(turn.autonomy, "gated");
  assert.deepEqual(turn.steps, []);
  assert.deepEqual(turn.artifacts, []);
  assert.equal(turn.usage.total_tokens, 0);
});

test("turn helpers update status and append steps immutably", () => {
  const turn = createAgentTurn({ sessionId: "sess_1", userMessage: "hello" });
  const step = createAgentStep({ turnId: turn.id, type: "classify", channel: "system" });
  const withStep = addTurnStep(turn, step);
  const completed = setTurnStatus(withStep, "completed");

  assert.equal(turn.steps.length, 0);
  assert.equal(withStep.steps.length, 1);
  assert.equal(completed.status, "completed");
  assert.notEqual(completed.updated_at, undefined);
});

test("createAgentStep and completeAgentStep build step lifecycle records", () => {
  const step = createAgentStep({ turnId: "turn_1", type: "model", channel: "think" });
  const completed = completeAgentStep(step, { outputRef: "artifact_1" });

  assert.ok(step.id.startsWith("step_"));
  assert.equal(step.status, "started");
  assert.equal(completed.status, "completed");
  assert.equal(completed.output_ref, "artifact_1");
  assert.ok(Date.parse(completed.ended_at) > 0);
});

test("tool and approval protocol records use stable field names", () => {
  const call = createToolCall({
    name: "read",
    params: { path: "README.md" },
    requestedByStepId: "step_1"
  });
  const result = createToolResult({
    callId: call.id,
    status: "success",
    content: [{ type: "text", text: "ok" }]
  });
  const approval = createApprovalRequest({
    turnId: "turn_1",
    kind: "tool",
    risk: "medium",
    summary: "Read README"
  });

  assert.equal(call.name, "read");
  assert.equal(call.requested_by_step_id, "step_1");
  assert.equal(result.call_id, call.id);
  assert.equal(result.status, "success");
  assert.equal(approval.kind, "tool");
  assert.deepEqual(approval.decisions, ["approve", "deny"]);
});

test("createArtifact records durable artifact metadata", () => {
  const artifact = createArtifact({
    kind: "diff",
    path: ".deepseek-code/artifacts/a.diff",
    hash: "sha256:abc",
    size: 42
  });

  assert.ok(artifact.id.startsWith("artifact_"));
  assert.equal(artifact.kind, "diff");
  assert.equal(artifact.ttl, null);
  assert.deepEqual(artifact.metadata, {});
});

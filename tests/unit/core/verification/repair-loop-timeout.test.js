import test from "node:test";
import assert from "node:assert/strict";
import { runRepairExecutor } from "../../../../src/core/execution/repair-executor.js";
import { runRepairLoop } from "../../../../src/core/verification/repair-loop.js";

test("runRepairExecutor forwards modelTimeoutMs as timeoutMs to gateway.invoke", async () => {
  let seen = null;
  const modelGateway = { invoke: async (messages, options) => { seen = options; return { content: "fixed", tool_calls: [] }; } };
  const result = await runRepairExecutor({
    turnId: "t1",
    messages: [{ role: "user", content: "fix" }],
    modelGateway,
    toolSchemas: [],
    executeTool: async () => ({ status: "success", content: [] }),
    createPolicyContext: () => ({}),
    modelTimeoutMs: 1234
  });
  assert.equal(result.status, "complete");
  assert.equal(seen.timeoutMs, 1234);
});

test("runRepairLoop threads modelTimeoutMs into the repair executor", async () => {
  let seenTimeout;
  const fakeExecutor = async (args) => { seenTimeout = args.modelTimeoutMs; return { status: "complete", content: "x", toolResults: [] }; };
  const fakeVerifier = async () => ({ status: "passed" });
  await runRepairLoop({
    turnId: "t1",
    userMessage: "fix",
    modelGateway: { invoke: async () => ({ content: "", tool_calls: [] }) },
    executeTool: async () => ({ status: "success", content: [] }),
    createPolicyContext: () => ({}),
    verificationPolicy: {},
    initialVerification: { status: "failed" },
    initialToolResults: [],
    maxRepairAttempts: 1,
    modelTimeoutMs: 777,
    runRepairExecutorImpl: fakeExecutor,
    runVerifierImpl: fakeVerifier
  });
  assert.equal(seenTimeout, 777);
});

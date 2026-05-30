import test from "node:test";
import assert from "node:assert/strict";
import {
  runKernelAgentCommand,
  runKernelTestCommand,
  buildEditPrompt
} from "../../../../src/apps/cli/kernel-runner.js";

function createMockKernel(result, events = []) {
  return {
    session: {
      subscribe(handler) {
        for (const event of events) handler(event);
        return { unsubscribe() { events.push({ unsubscribed: true }); } };
      }
    },
    agent: {
      send: async (message, options) => ({ ...result, seen: { message, options } })
    },
    tools: {
      execute: async (toolCall, options) => ({
        call: toolCall,
        options,
        status: "success",
        content: [{ type: "text", text: "test output" }],
        metadata: { argv: toolCall.params.argv || ["node", "--test"] }
      })
    }
  };
}

test("runKernelAgentCommand sends prompt through V2 kernel and renders result", async () => {
  const lines = [];
  const result = await runKernelAgentCommand({
    root: "/repo",
    prompt: "what is this?",
    autonomy: "gated",
    write: (line) => lines.push(line),
    createKernelImpl: async () => createMockKernel({ status: "complete", content: "answer" }, [
      { type: "tool:call", call: { name: "read" } }
    ])
  });

  assert.equal(result.status, "complete");
  assert.equal(result.seen.options.autonomy, "gated");
  assert.ok(lines.includes("- tool read"));
  assert.ok(lines.includes("answer"));
});

test("runKernelAgentCommand unsubscribes after send", async () => {
  const events = [];
  await runKernelAgentCommand({
    root: "/repo",
    prompt: "hello",
    write: () => {},
    createKernelImpl: async () => createMockKernel({ status: "complete", content: "ok" }, events)
  });

  assert.equal(events.at(-1).unsubscribed, true);
});

test("runKernelTestCommand executes V2 test tool directly", async () => {
  const lines = [];
  const result = await runKernelTestCommand({
    root: "/repo",
    argv: ["node", "--test"],
    write: (line) => lines.push(line),
    createKernelImpl: async () => createMockKernel({ status: "complete", content: "unused" })
  });

  assert.equal(result.call.name, "test");
  assert.deepEqual(result.call.params, { detect: false, argv: ["node", "--test"] });
  assert.equal(result.options.autonomy, "auto");
  assert.ok(lines.some((line) => line.includes("test output")));
});

test("buildEditPrompt preserves dry-run as an explicit model instruction", () => {
  assert.equal(
    buildEditPrompt("change README", { dryRun: true }),
    "change README\n\nConstraint: preview the diff only. Use diff_preview and do not apply changes."
  );
  assert.equal(buildEditPrompt("change README", { dryRun: false }), "change README");
});

test("runKernelTestCommand passes through non-zero exit code from shell tool", async () => {
  const result = await runKernelTestCommand({
    root: "/repo",
    argv: ["node", "-e", "process.exit(7)"],
    createKernelImpl: async () => ({
      session: { subscribe: () => ({ unsubscribe() {} }) },
      tools: {
        execute: async () => ({
          status: "success",
          content: [{ type: "text", text: "test output" }],
          metadata: { exit_code: 7, argv: ["node", "-e", "process.exit(7)"] }
        })
      }
    })
  });

  // V2 test tool returns status:"success" even when the command fails;
  // the real exit_code is in metadata and must be propagated by the CLI caller.
  assert.equal(result.status, "success");
  assert.equal(result.metadata.exit_code, 7);
});

test("runKernelAgentCommand prompts and resumes approval in process", async () => {
  const writes = [];
  const approvals = [];
  const result = await runKernelAgentCommand({
    root: "/repo",
    prompt: "modify a",
    write: (line) => writes.push(line),
    createKernelImpl: async () => ({
      session: { subscribe: () => ({ unsubscribe() {} }) },
      agent: {
        send: async () => ({ status: "awaiting_approval", approval: { id: "approval_1" }, content: "approval needed" }),
        approve: async (id, decision) => {
          approvals.push([id, decision]);
          return { status: "complete", content: "resumed final" };
        }
      }
    }),
    promptApproval: async () => "y"
  });

  assert.equal(result.status, "complete");
  assert.deepEqual(approvals, [["approval_1", "approve"]]);
  assert.ok(writes.some((line) => line.includes("resumed final")));
});

test("runKernelAgentCommand loops until no more awaiting_approval", async () => {
  // Simulate: first approval (edit) resumes but immediately pauses again (shell)
  const writes = [];
  const approvals = [];
  let sendCalls = 0;
  const result = await runKernelAgentCommand({
    root: "/repo",
    prompt: "edit and run",
    write: (line) => writes.push(line),
    createKernelImpl: async () => ({
      session: { subscribe: () => ({ unsubscribe() {} }) },
      agent: {
        send: async () => {
          sendCalls += 1;
          return { status: "awaiting_approval", approval: { id: "approval_1" }, content: "first pause" };
        },
        approve: async (id, decision) => {
          approvals.push([id, decision]);
          if (approvals.length === 1) {
            return { status: "awaiting_approval", approval: { id: "approval_2" }, content: "second pause" };
          }
          return { status: "complete", content: "all done" };
        }
      }
    }),
    promptApproval: async (approval) => (approval.id === "approval_1" ? "y" : "y")
  });

  assert.equal(result.status, "complete");
  assert.equal(result.content, "all done");
  assert.deepEqual(approvals, [["approval_1", "approve"], ["approval_2", "approve"]]);
  assert.equal(sendCalls, 1);
});

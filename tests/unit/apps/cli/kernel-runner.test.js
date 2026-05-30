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

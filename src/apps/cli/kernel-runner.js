import { createKernel } from "../../index.js";
import { createToolCall } from "../../core/protocol/index.js";
import { buildKernelOptions } from "../kernel-options.js";
import { createEventRenderer, renderKernelResult } from "./render-events.js";

export { buildKernelOptions } from "../kernel-options.js";

export async function runKernelAgentCommand({
  root,
  prompt,
  autonomy = "gated",
  write = console.log,
  createKernelImpl = createKernel,
  createKernelOptions = {},
  loadConfigImpl = null,
  sendOptions = {},
  promptApproval = defaultPromptApproval
} = {}) {
  const message = String(prompt || "").trim();
  if (!message) throw new Error("prompt is required");

  const kernel = await createKernelForRunner({ root, createKernelImpl, createKernelOptions, loadConfigImpl });
  const renderEvent = createEventRenderer({ write });
  const subscription = kernel.session.subscribe(renderEvent);
  try {
    const result = await kernel.agent.send(message, { autonomy, ...sendOptions });
    return await resolveApprovals({ kernel, result, write, promptApproval });
  } finally {
    subscription.unsubscribe();
  }
}

export async function runKernelChatCommand({
  root,
  prompt = "",
  write = console.log,
  question = defaultQuestion,
  createKernelImpl = createKernel,
  createKernelOptions = {},
  loadConfigImpl = null,
  sendOptions = {},
  promptApproval = defaultPromptApproval
} = {}) {
  const kernel = await createKernelForRunner({ root, createKernelImpl, createKernelOptions, loadConfigImpl });
  const renderEvent = createEventRenderer({ write });
  const subscription = kernel.session.subscribe(renderEvent);
  try {
    const initialPrompt = String(prompt || "").trim();
    if (initialPrompt) {
      const result = await kernel.agent.send(initialPrompt, {
        ...sendOptions,
        autonomy: "read-only",
        history: []
      });
      return await resolveApprovals({ kernel, result, write, promptApproval });
    }

    return await runChatRepl({
      kernel,
      write,
      question,
      sendOptions,
      promptApproval
    });
  } finally {
    subscription.unsubscribe();
  }
}

export async function resolveApprovals({ kernel, result, write = console.log, promptApproval = defaultPromptApproval } = {}) {
  let current = result;
  for (const line of renderKernelResult(current)) write(line);
  while (current.status === "awaiting_approval" && current.approval?.id) {
    const answer = await promptApproval(current.approval);
    const decision = isApprovalYes(answer) ? "approve" : "deny";
    current = await kernel.agent.approve(current.approval.id, decision);
    for (const line of renderKernelResult(current)) write(line);
  }
  return current;
}

async function runChatRepl({ kernel, write, question, sendOptions, promptApproval }) {
  let mode = "read-only";
  let history = [];
  write("chat mode: read-only");
  write("commands: /mode [read-only|gated|auto], /clear, /history, /exit");

  while (true) {
    const input = String(await question(`chat(${mode})> `) || "").trim();
    if (!input) continue;

    if (input.startsWith("/")) {
      const commandResult = await handleChatCommand({ input, mode, history, kernel, write });
      mode = commandResult.mode;
      history = commandResult.history;
      if (commandResult.exit) {
        return { status: "complete", content: "chat exited" };
      }
      continue;
    }

    const result = await kernel.agent.send(input, {
      ...sendOptions,
      autonomy: mode,
      history
    });
    const resolved = await resolveApprovals({ kernel, result, write, promptApproval });
    if (resolved.status === "complete") {
      history = appendHistory(history, input, resolved.content || "");
    }
  }
}

async function handleChatCommand({ input, mode, history, kernel, write }) {
  const [command, rawArg] = input.slice(1).trim().split(/\s+/, 2);
  if (command === "exit" || command === "quit") {
    return { mode, history, exit: true };
  }
  if (command === "mode") {
    const requested = rawArg ? String(rawArg).trim() : "";
    const nextMode = requested || nextChatMode(mode);
    if (!["read-only", "gated", "auto"].includes(nextMode)) {
      write("mode must be read-only, gated, or auto");
      return { mode, history, exit: false };
    }
    write(`mode: ${nextMode}`);
    return { mode: nextMode, history, exit: false };
  }
  if (command === "clear") {
    write("history cleared");
    return { mode, history: [], exit: false };
  }
  if (command === "history") {
    const timeline = await kernel.session.getTimeline?.({ count: 10000 }).catch?.(() => null);
    const eventCount = Array.isArray(timeline) ? timeline.length : (Array.isArray(timeline?.events) ? timeline.events.length : null);
    const turnCount = Math.floor(history.length / 2);
    write(eventCount == null ? `history turns: ${turnCount}` : `history turns: ${turnCount}, events: ${eventCount}`);
    return { mode, history, exit: false };
  }
  write(`unknown command: /${command}`);
  return { mode, history, exit: false };
}

function nextChatMode(mode) {
  if (mode === "read-only") return "gated";
  if (mode === "gated") return "auto";
  return "read-only";
}

function appendHistory(history, user, assistant) {
  return [
    ...history,
    { role: "user", content: user },
    { role: "assistant", content: assistant }
  ].slice(-20);
}

async function createKernelForRunner({ root, createKernelImpl = createKernel, createKernelOptions = {}, loadConfigImpl = null } = {}) {
  const kernelOptions = createKernelImpl === createKernel
    ? await buildKernelOptions(root, createKernelOptions, loadConfigImpl || undefined)
    : createKernelOptions;
  return createKernelImpl(root, kernelOptions);
}

async function defaultQuestion(prompt) {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function defaultPromptApproval(approval) {
  const { createInterface } = await import("node:readline/promises");
  const { stdin, stdout } = await import("node:process");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(`Approve ${approval.id}? y/N `);
  } finally {
    rl.close();
  }
}

function isApprovalYes(answer) {
  const value = String(answer || "").trim().toLowerCase();
  return value === "y" || value === "yes" || value === "approve" || value === "allow";
}

export async function runKernelTestCommand({
  root,
  argv = [],
  write = console.log,
  createKernelImpl = createKernel,
  createKernelOptions = {},
  loadConfigImpl = null
} = {}) {
  const kernelOptions = createKernelImpl === createKernel
    ? await buildKernelOptions(root, createKernelOptions, loadConfigImpl || undefined)
    : createKernelOptions;
  const kernel = await createKernelImpl(root, kernelOptions);
  const params = argv.length ? { detect: false, argv } : { detect: false };
  const result = await kernel.tools.execute(
    createToolCall({
      name: "test",
      params,
      source: "cli",
      requestedByStepId: "cli:test"
    }),
    { autonomy: "auto", turnId: "cli:test" }
  );

  for (const item of result.content || []) {
    if (item.text) write(item.text);
  }
  if (result.metadata?.argv) write(`command: ${result.metadata.argv.join(" ")}`);
  return result;
}

export function buildEditPrompt(prompt, { dryRun = false } = {}) {
  const text = String(prompt || "").trim();
  if (!dryRun) return text;
  return `${text}\n\nConstraint: preview the diff only. Use diff_preview and do not apply changes.`;
}

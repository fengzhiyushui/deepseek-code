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

  const kernelOptions = createKernelImpl === createKernel
    ? await buildKernelOptions(root, createKernelOptions, loadConfigImpl || undefined)
    : createKernelOptions;
  const kernel = await createKernelImpl(root, kernelOptions);
  const renderEvent = createEventRenderer({ write });
  const subscription = kernel.session.subscribe(renderEvent);
  try {
    let result = await kernel.agent.send(message, { autonomy, ...sendOptions });
    for (const line of renderKernelResult(result)) write(line);
    if (result.status === "awaiting_approval" && result.approval?.id) {
      const answer = await promptApproval(result.approval);
      const decision = isApprovalYes(answer) ? "approve" : "deny";
      result = await kernel.agent.approve(result.approval.id, decision);
      for (const line of renderKernelResult(result)) write(line);
    }
    return result;
  } finally {
    subscription.unsubscribe();
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

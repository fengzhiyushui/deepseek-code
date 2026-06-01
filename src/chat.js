import { runKernelChatCommand } from "./apps/cli/kernel-runner.js";

export async function chatCommand(input = {}) {
  return runKernelChatCommand(input);
}

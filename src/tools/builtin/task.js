export function createTaskTool() {
  return {
    name: "task",
    description: "Delegate a bounded subtask with constrained tools",
    category: "execute",
    side_effect: "process",
    risk_level: "medium",
    source: "builtin",
    version: "2.0",
    params: {
      prompt: { type: "string" },
      tools: { type: "array", required: false }
    },
    execute: async (params) => {
      const delegatedTools = (params.tools || ["read", "grep", "glob"]).slice(0, 5);
      return {
        content: [{ type: "text", text: `Subtask queued: ${params.prompt}` }],
        metadata: { status: "delegated", delegated_tools: delegatedTools }
      };
    }
  };
}

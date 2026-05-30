export function createAskUserTool() {
  return {
    name: "ask_user",
    description: "Ask the user a clarification question",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: { question: { type: "string" } },
    execute: async (params) => ({
      status: "awaiting_user",
      content: [{ type: "text", text: params.question }],
      metadata: { question: params.question }
    })
  };
}

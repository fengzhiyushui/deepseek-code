const SAFE_METADATA_KEYS = new Set(["path", "bytes", "argv", "exit_code", "signal", "change_id", "summary", "files", "diff_hash", "diff_size"]);

export function buildRepairMessages({
  userMessage,
  classification = {},
  verification = {},
  toolResults = [],
  previousRepairAttempts = [],
  maxRepairAttempts = 2,
  context = null
} = {}) {
  const payload = {
    task: String(userMessage || ""),
    task_type: classification.task_type || "general",
    context_summary: clip(context?.summary || "", 6000),
    verification: {
      status: verification.status || "unknown",
      reason: clip(verification.reason || "", 2000),
      exit_code: verification.exit_code ?? verification.tool_result?.metadata?.exit_code ?? null
    },
    tool_results: summarizeRepairToolResults(toolResults),
    previous_repair_attempts: previousRepairAttempts.map((attempt) => ({
      attempt: attempt.attempt,
      status: attempt.status,
      verification_status: attempt.verification_status
    })),
    max_repair_attempts: maxRepairAttempts
  };

  return [
    {
      role: "system",
      content: [
        "You are Inkstone repair mode.",
        "The previous edit failed verification.",
        "Use the smallest safe corrective change.",
        "Prefer read, grep, glob, and edit tools.",
        "Do not expose hidden reasoning.",
        "Return tool calls when repair is needed; return a final answer only when no tool call is needed."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify(payload)
    }
  ];
}

export function summarizeRepairToolResults(results = [], { maxTextChars = 2000 } = {}) {
  return results.map((result) => {
    const text = (result.content || []).map((item) => item.text || "").join("\n");
    return {
      call_id: result.call_id,
      status: result.status,
      text: clip(text, maxTextChars),
      truncated: text.length > maxTextChars,
      metadata: safeMetadata(result.metadata || {})
    };
  });
}

function safeMetadata(metadata) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_KEYS.has(key)) safe[key] = value;
  }
  return safe;
}

function clip(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

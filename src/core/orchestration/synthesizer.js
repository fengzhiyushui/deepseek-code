export function createSynthesizer({ callModel }) {
  async function synthesize({ message, collected }) {
    try {
      const out = await callModel(synthPrompt(message, collected));
      if (out && String(out).trim()) return String(out);
    } catch { /* fall through to deterministic summary */ }
    return deterministicSummary(collected);
  }
  return { synthesize };
}

function synthPrompt(message, collected) {
  const lines = collected.map((c) => `- ${c.st.id} (${c.status}): ${c.status === "complete" ? (c.wres?.content || "").slice(0, 400) : `FAILED: ${c.lastFeedback || ""}`}`);
  return [
    `Synthesize a final answer for the user's request: ${message}`,
    "Sub-task outcomes:", lines.join("\n"),
    "Report honestly: state clearly which sub-tasks failed and why; do not claim success for failed parts."
  ].join("\n\n");
}

function deterministicSummary(collected) {
  const done = collected.filter((c) => c.status === "complete");
  const failed = collected.filter((c) => c.status !== "complete");
  const parts = [`Completed ${done.length}/${collected.length} sub-tasks.`];
  for (const c of done) parts.push(`✓ ${c.st.id}: ${(c.wres?.content || "").slice(0, 200)}`);
  for (const c of failed) parts.push(`✗ ${c.st.id} FAILED: ${c.lastFeedback || "unknown"}`);
  return parts.join("\n");
}

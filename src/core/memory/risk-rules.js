// Maps retrieved risk cues to "escalate_only" project rules. These are NOT normal
// allow/deny rules — the permission engine skips them in its rule loop and only uses
// them in a monotonic escalation pass (allow -> ask), never to downgrade.
export function riskRules(riskCues) {
  const cues = riskCues instanceof Set ? [...riskCues] : Array.isArray(riskCues) ? riskCues : [];
  return cues
    .map((c) => String(c || "").toLowerCase())
    .filter((c) => c.length > 0)
    .map((cue) => ({ escalate_only: true, cue, id: `risk:${cue}` }));
}

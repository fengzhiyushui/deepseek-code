// Fold the workbench activity event stream into agent-panel card view-models.
// Pure — node:test-covered. Real cards replace the D-1 sample preview once events arrive.
export function deriveAgentCards(activity) {
  const cards = [];
  const toolIndex = new Map();
  let planCard = null;
  for (const e of activity || []) {
    const type = e && e.type;
    if (type === "orchestration:planned" || type === "orchestration:round_started" || type === "orchestration:replanned") {
      if (!planCard) { planCard = { kind: "plan", subtasks: 0, round: 0 }; cards.push(planCard); }
      if (typeof e.subtasks === "number") planCard.subtasks = e.subtasks;
      if (typeof e.new_subtasks === "number") planCard.subtasks = e.new_subtasks;
      if (typeof e.round === "number") planCard.round = e.round;
    } else if (type === "tool:call") {
      const card = { kind: "tool", id: e.id, tool: e.tool || e.name || "tool", status: "running" };
      toolIndex.set(e.id, card);
      cards.push(card);
    } else if (type === "tool:result") {
      const card = toolIndex.get(e.id);
      if (card) card.status = e.status === "error" ? "error" : "ok";
    } else if (type === "file:diff_applied" || type === "file:diff_preview") {
      cards.push({ kind: "diff", path: e.path || "", added: e.added || 0, removed: e.removed || 0, applied: type === "file:diff_applied" });
    } else if (type === "verification:result") {
      cards.push({ kind: "test", pass: Boolean(e.pass) });
    }
  }
  return cards;
}

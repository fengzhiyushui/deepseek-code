// Fold the workbench activity event stream into agent-panel card view-models.
// Pure — node:test-covered. 字段归一走共享事件展示契约(src/apps/event-contract.js),避免第 4 份并行读法。
import { describeEvent } from "../../../src/apps/event-contract.js";

export function deriveAgentCards(activity) {
  const cards = [];
  const toolIndex = new Map();
  let planCard = null;
  for (const e of activity || []) {
    const type = e && e.type;
    const f = describeEvent(e).fields;
    if (type === "orchestration:planned" || type === "orchestration:round_started" || type === "orchestration:replanned") {
      if (!planCard) { planCard = { kind: "plan", subtasks: 0, round: 0 }; cards.push(planCard); }
      if (typeof f.subtasks === "number") planCard.subtasks = f.subtasks;
      if (typeof f.newSubtasks === "number") planCard.subtasks = f.newSubtasks;
      if (typeof f.round === "number") planCard.round = f.round;
    } else if (type === "tool:call") {
      const card = { kind: "tool", id: e.id, tool: f.name || "tool", status: "running" };
      toolIndex.set(e.id, card);
      cards.push(card);
    } else if (type === "tool:result") {
      const card = toolIndex.get(e.id);
      if (card) card.status = f.status === "error" ? "error" : "ok";
    } else if (type === "file:diff_applied" || type === "file:diff_preview") {
      const paths = (f.files || []).map((x) => x.path).filter(Boolean);
      cards.push({
        kind: "diff",
        changeId: f.changeId,
        path: paths[0] || "",
        fileCount: paths.length,
        applied: type === "file:diff_applied"
      });
    } else if (type === "verification:result") {
      cards.push({ kind: "test", pass: Boolean(f.pass) });
    }
  }
  return cards;
}

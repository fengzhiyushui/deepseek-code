import { validatePlan, hasCycle } from "./subtask-schema.js";

export function createPlanner({ callModel, maxPlanRepairs = 2 }) {
  async function plan({ message, context }) {
    let feedback = null;
    for (let attempt = 0; attempt <= maxPlanRepairs; attempt += 1) {
      let raw;
      try { raw = await callModel(plannerPrompt(message, context, feedback)); }
      catch (e) { feedback = `model error: ${e.message}`; continue; }
      const obj = extractJson(raw);
      if (!obj) { feedback = "output was not valid JSON; reply with ONLY the JSON plan"; continue; }
      const v = validatePlan(obj);
      if (!v.ok) { feedback = `plan invalid: ${v.error}`; continue; }
      if (hasCycle(v.plan.subtasks)) { feedback = "plan had a dependency cycle; remove it"; continue; }
      return v.plan;
    }
    return degradeToSingle(message);
  }
  return { plan };
}

function degradeToSingle(message) {
  return {
    task_summary: String(message || "").slice(0, 200),
    done_when: "the request is fulfilled",
    subtasks: [{ id: "st_1", goal: String(message || ""), acceptance: ["request fulfilled"], context_scope: {}, tool_profile: "edit", depends_on: [] }]
  };
}

function plannerPrompt(message, context, feedback) {
  return [
    "Break the user's request into a minimal set of sub-tasks for sub-agents to execute SEQUENTIALLY.",
    `User request: ${message}`,
    context ? `Context summary: ${context.summary || ""}` : "",
    'Reply with ONLY JSON: {"task_summary","done_when","subtasks":[{"id","goal","acceptance":[...],"context_scope":{"files":[...]},"tool_profile":"edit"|"readonly","depends_on":[...]}]}',
    "Use depends_on to express ordering. Keep it minimal — do not over-decompose.",
    feedback ? `Your previous attempt was rejected: ${feedback}` : ""
  ].filter(Boolean).join("\n\n");
}

function extractJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

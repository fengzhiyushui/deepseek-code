import { topoOrder } from "./subtask-schema.js";

export async function runDispatchLoop({ plan, workerFactory, makeReviewer, synthesizer, budget, maxWorkerAttempts, autonomy, onEvent }) {
  let order;
  try { order = topoOrder(plan.subtasks); }
  catch { order = [...plan.subtasks]; } // cycle already excluded by planner; be defensive
  const collected = [];

  for (const st of order) {
    let priorFeedback = null;
    let settled = false;
    for (let attempt = 1; attempt <= maxWorkerAttempts; attempt += 1) {
      onEvent?.("subtask_started", { subtask_id: st.id, attempt, tool_profile: st.tool_profile });
      const worker = workerFactory.worker(st);
      const wres = await worker.send(workerPrompt(st, priorFeedback), { autonomy });

      if (wres.status === "awaiting_approval") return { status: "awaiting_approval", approval: wres.approval, collected };
      if (wres.status === "stopped") { collected.push({ st, status: "failed", lastFeedback: "worker stopped (budget)" }); settled = true; break; }
      if (wres.status !== "complete") { priorFeedback = `self-audit failed: ${wres.content || wres.status}`; continue; } // 关卡1

      const verdict = await makeReviewer().review(st, wres); // 关卡2 (独立)
      onEvent?.("subtask_reviewed", { subtask_id: st.id, pass: verdict.pass, severity: verdict.severity });
      if (verdict.pass) { collected.push({ st, wres, verdict, status: "complete" }); settled = true; break; }
      priorFeedback = (verdict.reasons || []).join("; ") || "review rejected";
    }
    if (!settled) collected.push({ st, status: "failed", lastFeedback: priorFeedback });
    if (budget.exceeded()) { const content = await synthesizer.synthesize({ collected }); return { status: "complete", content, collected, stopped_reason: "budget" }; }
  }

  const content = await synthesizer.synthesize({ collected });
  return { status: "complete", content, collected };
}

function workerPrompt(st, priorFeedback) {
  return [
    `Sub-task: ${st.goal}`,
    `Acceptance criteria:\n${(st.acceptance || []).map((a) => `- ${a}`).join("\n")}`,
    priorFeedback ? `A previous attempt was rejected. Address this feedback: ${priorFeedback}` : ""
  ].filter(Boolean).join("\n\n");
}

import { topoOrder } from "./subtask-schema.js";
import { withinScope, overlaps } from "./path-overlap.js";

export async function runDispatchLoop({
  plan, workerFactory, makeReviewer, synthesizer, budget, maxWorkerAttempts, autonomy, onEvent,
  toBatches, maxParallelWorkers = 1, runIsolatedWorker, mergeSubtask, removeIso
}) {
  // C3 batched parallel path: only when explicitly wired + allowed. Otherwise the
  // C1+C2 sequential path runs verbatim (zero regression).
  if (maxParallelWorkers > 1 && typeof toBatches === "function" && typeof runIsolatedWorker === "function") {
    return runBatched({ plan, workerFactory, makeReviewer, synthesizer, budget, maxWorkerAttempts, autonomy, toBatches, maxParallelWorkers, runIsolatedWorker, mergeSubtask, removeIso, onEvent });
  }

  const order = orderOf(plan);
  const collected = [];
  for (const st of order) {
    const r = await processSubtask(st, { workerFactory, makeReviewer, maxWorkerAttempts, autonomy, onEvent });
    if (r.control === "awaiting_approval") return { status: "awaiting_approval", approval: r.approval, collected };
    collected.push(r.entry);
    if (budget.exceeded()) return finishPartial(collected, synthesizer, "budget");
  }
  return finishPartial(collected, synthesizer, null);
}

function orderOf(plan) {
  try { return topoOrder(plan.subtasks); } catch { return [...plan.subtasks]; }
}

async function finishPartial(collected, synthesizer, stopped_reason) {
  const content = await synthesizer.synthesize({ collected });
  return stopped_reason ? { status: "complete", content, collected, stopped_reason } : { status: "complete", content, collected };
}

// One sub-task in the MAIN workspace (C1+C2): worker self-audit + retry, then
// independent reviewer + retry, bounded by maxWorkerAttempts.
async function processSubtask(st, { workerFactory, makeReviewer, maxWorkerAttempts, autonomy, onEvent }) {
  let priorFeedback = null;
  for (let attempt = 1; attempt <= maxWorkerAttempts; attempt += 1) {
    onEvent?.("subtask_started", { subtask_id: st.id, attempt, tool_profile: st.tool_profile });
    const worker = workerFactory.worker(st);
    const wres = await worker.send(workerPrompt(st, priorFeedback), { autonomy });
    if (wres.status === "awaiting_approval") return { control: "awaiting_approval", approval: wres.approval };
    if (wres.status === "stopped") return { entry: { st, status: "failed", lastFeedback: "worker stopped (budget)" } };
    if (wres.status !== "complete") { priorFeedback = `self-audit failed: ${wres.content || wres.status}`; continue; }
    const verdict = await makeReviewer().review(st, wres);
    onEvent?.("subtask_reviewed", { subtask_id: st.id, pass: verdict.pass, severity: verdict.severity });
    if (verdict.pass) return { entry: { st, wres, verdict, status: "complete" } };
    priorFeedback = (verdict.reasons || []).join("; ") || "review rejected";
  }
  return { entry: { st, status: "failed", lastFeedback: priorFeedback } };
}

// C3: batches (size 1 → main path, no copy; size >1 → isolated parallel + merge).
async function runBatched({ plan, workerFactory, makeReviewer, synthesizer, budget, maxWorkerAttempts, autonomy, toBatches, maxParallelWorkers, runIsolatedWorker, mergeSubtask, removeIso, onEvent }) {
  const order = orderOf(plan);
  const runId = `run_${order.map((s) => s.id).join("-")}`.slice(0, 80);
  const batches = toBatches(order, { completedIds: new Set(), maxParallelWorkers });
  const collected = [];

  for (const batch of batches) {
    if (batch.length === 1) {
      const r = await processSubtask(batch[0], { workerFactory, makeReviewer, maxWorkerAttempts, autonomy, onEvent });
      if (r.control === "awaiting_approval") return { status: "awaiting_approval", approval: r.approval, collected };
      collected.push(r.entry);
    } else {
      const results = await Promise.all(batch.map((st) =>
        Promise.resolve(runIsolatedWorker({ subtask: st, runId })).catch((error) => ({ st, error }))));
      results.sort((a, b) => (a.st.id < b.st.id ? -1 : a.st.id > b.st.id ? 1 : 0)); // deterministic merge order
      const actuals = results.map((r) => ({ id: r.st.id, paths: actualPaths(r.actual) }));
      for (const r of results) {
        try { collected.push(await settleWorker(r, { mergeSubtask, actuals })); }
        finally { if (r.isoRoot && removeIso) await removeIso(r.isoRoot).catch(() => {}); } // zero residue
      }
    }
    if (budget.exceeded()) return finishPartial(collected, synthesizer, "budget");
  }
  return finishPartial(collected, synthesizer, null);
}

function actualPaths(actual) { return actual ? [...actual.added, ...actual.modified, ...actual.deleted] : []; }

async function settleWorker(r, { mergeSubtask, actuals }) {
  if (r.error || !r.wres || r.wres.status !== "complete") {
    return { st: r.st, status: "failed", lastFeedback: r.error?.message || "worker did not complete" };
  }
  if (!r.verdict?.pass) {
    return { st: r.st, status: "failed", lastFeedback: (r.verdict?.reasons || []).join("; ") || "review rejected" };
  }
  // actual write-scope validation (do not trust declared scope)
  const declared = r.st.context_scope?.files || [];
  const paths = actualPaths(r.actual);
  const stray = withinScope(paths, declared);
  if (stray.length) return { st: r.st, status: "failed", lastFeedback: `out-of-scope writes: ${stray.join(", ")}` };
  // cross-worker actual overlap (defense beyond declared disjointness)
  for (const other of actuals) {
    if (other.id === r.st.id) continue;
    if (overlaps(paths, other.paths)) return { st: r.st, status: "failed", lastFeedback: `actual file overlap with ${other.id}` };
  }
  const merged = await mergeSubtask(r);
  if (!merged.ok) return { st: r.st, status: "failed", lastFeedback: merged.reason };
  return { st: r.st, wres: r.wres, verdict: r.verdict, status: "complete", change_id: merged.change_id };
}

function workerPrompt(st, priorFeedback) {
  return [
    `Sub-task: ${st.goal}`,
    `Acceptance criteria:\n${(st.acceptance || []).map((a) => `- ${a}`).join("\n")}`,
    priorFeedback ? `A previous attempt was rejected. Address this feedback: ${priorFeedback}` : ""
  ].filter(Boolean).join("\n\n");
}

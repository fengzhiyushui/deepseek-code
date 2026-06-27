import { runDispatchLoop, resumeDispatchLoop } from "./dispatch-loop.js";
import { fingerprint } from "./subtask-schema.js";

export function createOrchestrator({
  planner, makeWorkerFactory, makeReviewerFor, synthesizer, makeBudget, maxSubtasks, maxWorkerAttempts,
  eventBus, makeContext, maxParallelWorkers = 1, toBatches, runIsolatedWorker, mergeSubtask, removeIso, maxRounds = 1
}) {
  const orchPaused = new Map();   // approvalId -> { state, dispatchResume }  (C5 same-process resume; M6 uses it)

  async function run({ message, options = {}, routing = {} }) {
    const context = await makeContext?.({ message, options });
    const plan = await planner.plan({ message, context });
    if (plan.subtasks.length > maxSubtasks) plan.subtasks = plan.subtasks.slice(0, maxSubtasks);
    publish(eventBus, "orchestration:planned", { subtasks: plan.subtasks.length, done_when: plan.done_when });
    const state = {
      message, options, plan, round: 1, allCollected: [],
      seenSubtaskIds: new Set(plan.subtasks.map((s) => s.id)),
      seenFp: new Set(plan.subtasks.map(fingerprint)),
      budget: makeBudget(), stoppedByCap: false, done_when: plan.done_when
    };
    return driveFrom(state, { afterPausedRound: false });
  }

  function dispatchDeps(state) {
    const workerFactory = makeWorkerFactory();
    return {
      workerFactory,
      makeReviewer: () => makeReviewerFor(workerFactory),
      synthesizer, budget: state.budget, maxWorkerAttempts,
      autonomy: state.options.autonomy || "gated",
      onEvent: (type, data) => publish(eventBus, `orchestration:${type}`, data),
      toBatches, maxParallelWorkers, runIsolatedWorker, mergeSubtask, removeIso
    };
  }

  async function driveFrom(state, { afterPausedRound }) {
    let skipDispatch = afterPausedRound;
    let lastRoundCollected = [];
    while (true) {
      if (!skipDispatch) {
        publish(eventBus, "orchestration:round_started", { round: state.round, subtasks: state.plan.subtasks.length });
        const result = await runDispatchLoop({ plan: state.plan, ...dispatchDeps(state) });
        state.allCollected.push(...result.collected);
        if (result.status === "awaiting_approval") {
          orchPaused.set(result.approval.id, { state, dispatchResume: result.resume });
          return { status: "awaiting_approval", approval: result.approval, collected: state.allCollected };
        }
        lastRoundCollected = result.collected;
      } else {
        lastRoundCollected = state.allCollected;   // after a paused round, treat whole round's collected as progress signal
      }
      skipDispatch = false;
      const gate = await gateAndReplan(state, lastRoundCollected);
      if (!gate.continue) { state.stoppedByCap = gate.cap; break; }
      state.plan = { subtasks: gate.subtasks };
      state.round += 1;
    }
    return finalize(state);
  }

  async function gateAndReplan(state, roundCollected) {
    if (state.round >= maxRounds) return { continue: false, cap: true };
    if (state.budget.exceeded()) return { continue: false, cap: true };
    const completed = state.allCollected.filter((c) => c.status === "complete").map(sumEntry);
    const failed = state.allCollected.filter((c) => c.status !== "complete").map(sumEntry);
    const completedIds = new Set(completed.map((c) => c.id));
    const failedIds = new Set(failed.map((c) => c.id));
    let next;
    try {
      next = await planner.replan?.({ message: state.message, done_when: state.done_when, completed, failed, seenSubtaskIds: state.seenSubtaskIds, completedIds, failedIds });
    } catch { next = { done: true, subtasks: [] }; }
    if (!next || next.done || !next.subtasks?.length) return { continue: false, cap: false };
    // no-progress guard: round completed nothing AND every proposed subtask is a stale fingerprint
    const completedThisRound = (roundCollected || []).filter((c) => c.status === "complete").length;
    const fresh = next.subtasks.filter((s) => !state.seenFp.has(fingerprint(s)));
    if (completedThisRound === 0 && fresh.length === 0) return { continue: false, cap: false };
    publish(eventBus, "orchestration:replanned", { round: state.round + 1, done: false, new_subtasks: next.subtasks.length });
    for (const s of next.subtasks) { state.seenSubtaskIds.add(s.id); state.seenFp.add(fingerprint(s)); }
    return { continue: true, subtasks: next.subtasks, cap: false };
  }

  async function finalize(state) {
    const content = await synthesizer.synthesize({ message: state.message, collected: state.allCollected });
    const status = classifyOutcome(state.allCollected, { stoppedByCap: state.stoppedByCap });
    publish(eventBus, "orchestration:completed", { rounds: state.round, completed: count(state.allCollected, "complete"), failed: count(state.allCollected, "failed"), status });
    return { status: "complete", content, collected: state.allCollected, outcome: status };
  }

  function sumEntry(c) { return { id: c.st.id, goal: c.st.goal, note: c.status === "complete" ? String(c.wres?.content ?? "").slice(0, 160) : String(c.lastFeedback ?? "") }; }

  // C5: same-process orchestration resume. Finish the paused round, then continue
  // the round loop from saved state — no re-plan, no duplicate dispatch.
  async function resume(id, decision = "approve") {
    const saved = orchPaused.get(id);
    if (!saved) { const e = new Error(`no paused orchestration: ${id}`); e.code = "ORCH_NOT_PAUSED"; throw e; }
    orchPaused.delete(id);                                  // consume
    const { state, dispatchResume } = saved;
    const res = await resumeDispatchLoop(dispatchResume, decision);
    state.allCollected.push(...res.collected);
    if (res.status === "awaiting_approval") {
      orchPaused.set(res.approval.id, { state, dispatchResume: res.resume });   // re-pause: new id
      return { status: "awaiting_approval", approval: res.approval, collected: state.allCollected };
    }
    return driveFrom(state, { afterPausedRound: true });    // round done -> gate + further rounds
  }

  return { run, resume, hasPaused: (id) => orchPaused.has(id) };
}

// C5: final outcome — model's replan.done never auto-implies success.
function classifyOutcome(collected, { stoppedByCap }) {
  const failed = collected.filter((c) => c.status !== "complete").length;
  if (failed > 0) return "partial";
  if (stoppedByCap) return "incomplete";
  return "complete";
}

function count(c, s) { return c.filter((x) => x.status === s).length; }
function publish(bus, type, data) { if (bus && typeof bus.publish === "function") bus.publish(type, data); }

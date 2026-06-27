import { runDispatchLoop } from "./dispatch-loop.js";

export function createOrchestrator({ planner, makeWorkerFactory, makeReviewerFor, synthesizer, makeBudget, maxSubtasks, maxWorkerAttempts, eventBus, makeContext, maxParallelWorkers = 1, toBatches, runIsolatedWorker, mergeSubtask, removeIso }) {
  async function run({ message, options = {}, routing = {} }) {
    const context = await makeContext?.({ message, options });
    const plan = await planner.plan({ message, context });
    if (plan.subtasks.length > maxSubtasks) plan.subtasks = plan.subtasks.slice(0, maxSubtasks);
    publish(eventBus, "orchestration:planned", { subtasks: plan.subtasks.length, done_when: plan.done_when });

    const budget = makeBudget();
    const workerFactory = makeWorkerFactory();
    const autonomy = options.autonomy || "gated";
    const onEvent = (type, data) => publish(eventBus, `orchestration:${type}`, data);

    const result = await runDispatchLoop({
      plan,
      workerFactory,
      makeReviewer: () => makeReviewerFor(workerFactory),
      synthesizer,
      budget,
      maxWorkerAttempts,
      autonomy,
      onEvent,
      toBatches,
      maxParallelWorkers,
      runIsolatedWorker,
      mergeSubtask,
      removeIso
    });

    if (result.status === "awaiting_approval") {
      publish(eventBus, "orchestration:completed", { completed: count(result.collected, "complete"), failed: count(result.collected, "failed"), stopped_reason: "awaiting_approval" });
      return result;
    }
    publish(eventBus, "orchestration:completed", { completed: count(result.collected, "complete"), failed: count(result.collected, "failed"), stopped_reason: result.stopped_reason || null });
    return { status: "complete", content: result.content, collected: result.collected };
  }
  return { run };
}

function count(collected, status) { return (collected || []).filter((c) => c.status === status).length; }
function publish(eventBus, type, data) { if (eventBus && typeof eventBus.publish === "function") eventBus.publish(type, data); }

import { SESSION_EVENT_TYPES } from "./event-types.js";
import { BR_MAIN } from "./branch-store.js";

export function createSessionManager({
  eventBus,
  eventLog = null,
  eventTypes = SESSION_EVENT_TYPES,
  onError = defaultOnError,
  getActiveBranchId = () => BR_MAIN,
  getBranchAncestry = async (branchId) => [{ branch_id: branchId || BR_MAIN, forked_from_seq: 0 }]
} = {}) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new Error("eventBus with subscribe() is required");
  }

  const pending = new Set();
  const bridgeSubscriptions = eventLog
    ? eventTypes.map((type) => eventBus.subscribe(type, (data, meta) => {
        const stamped = stampBranch(type, data, getActiveBranchId);
        const write = eventLog.append(type, stamped, meta).catch((error) => {
          try {
            onError(error, type);
          } catch {
            // Error handlers must not break runtime event flow.
          }
        });
        pending.add(write);
        write.finally(() => pending.delete(write));
      }))
    : [];

  function subscribe(handler) {
    if (typeof handler !== "function") throw new Error("session subscriber must be a function");
    const subscriptions = eventTypes.map((type) => eventBus.subscribe(type, (data, meta) => {
      handler({ ...stampBranch(type, data, getActiveBranchId), type, meta });
    }));
    return {
      unsubscribe() {
        for (const sub of subscriptions) sub.unsubscribe();
      }
    };
  }

  async function flush() {
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
    if (eventLog && typeof eventLog.flush === "function") {
      await eventLog.flush();
    }
  }

  async function getTimeline(input = 20) {
    if (!eventLog || typeof eventLog.tail !== "function") return [];
    await flush();
    const options = normalizeTimelineOptions(input);
    const events = await eventLog.tail(options.scanCount);
    const normalized = events.map(normalizeBranchlessEvent);
    if (options.all_branches) return normalized.slice(-options.count);
    const branchId = options.branch_id || getActiveBranchId();
    const ancestry = await getBranchAncestry(branchId);
    return filterTimelineForBranch(normalized, ancestry).slice(-options.count);
  }

  function dispose() {
    for (const sub of bridgeSubscriptions) sub.unsubscribe();
  }

  return { subscribe, flush, getTimeline, dispose };
}

export function normalizeTimelineOptions(input) {
  if (typeof input === "number") {
    const count = safeCount(input);
    return { count, scanCount: Math.max(count * 5, count), all_branches: false, branch_id: null };
  }
  const count = safeCount(input?.count ?? 20);
  return {
    count,
    scanCount: safeCount(input?.scan_count ?? Math.max(count * 5, count)),
    all_branches: Boolean(input?.all_branches),
    branch_id: input?.branch_id || null
  };
}

export function normalizeBranchlessEvent(event) {
  if (!event || typeof event !== "object") return event;
  return { ...event, branch_id: event.branch_id || BR_MAIN };
}

export function filterTimelineForBranch(events, ancestry = []) {
  const chain = ancestry.length ? ancestry : [{ branch_id: BR_MAIN, forked_from_seq: 0 }];
  const allowed = new Set(chain.map((branch) => branch.branch_id));
  const forkSeqByBranch = new Map(chain.map((branch) => [branch.branch_id, Number(branch.forked_from_seq || 0)]));
  return events.filter((event) => {
    const branchId = event.branch_id || BR_MAIN;
    if (!allowed.has(branchId)) return false;
    const child = chain.find((item) => item.parent_branch_id === branchId);
    if (child && Number(event.seq || 0) > Number(child.forked_from_seq || 0)) return false;
    const ownForkSeq = forkSeqByBranch.get(branchId) || 0;
    return Number(event.seq || 0) >= ownForkSeq || branchId === BR_MAIN;
  });
}

function stampBranch(type, data, getActiveBranchId) {
  if (type === "session:branch_created" || type === "session:branch_activated") {
    return { ...data, branch_id: data?.branch_id || safeBranchId(getActiveBranchId()) };
  }
  const branchId = safeBranchId(getActiveBranchId());
  return { ...data, branch_id: branchId };
}

function safeBranchId(value) {
  return typeof value === "string" && value ? value : BR_MAIN;
}

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 20;
}

function defaultOnError(error, type) {
  console.error(`SessionManager: failed to persist ${type}: ${error.message}`);
}

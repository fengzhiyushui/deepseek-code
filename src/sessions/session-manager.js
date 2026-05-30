import { SESSION_EVENT_TYPES } from "./event-types.js";

export function createSessionManager({
  eventBus,
  eventLog = null,
  eventTypes = SESSION_EVENT_TYPES,
  onError = defaultOnError
} = {}) {
  if (!eventBus || typeof eventBus.subscribe !== "function") {
    throw new Error("eventBus with subscribe() is required");
  }

  const pending = new Set();
  const bridgeSubscriptions = eventLog
    ? eventTypes.map((type) => eventBus.subscribe(type, (data, meta) => {
        const write = eventLog.append(type, data, meta).catch((error) => {
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
      handler({ ...data, type, meta });
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

  async function getTimeline(count = 20) {
    if (!eventLog || typeof eventLog.tail !== "function") return [];
    await flush();
    return eventLog.tail(count);
  }

  function dispose() {
    for (const sub of bridgeSubscriptions) sub.unsubscribe();
  }

  return { subscribe, flush, getTimeline, dispose };
}

function defaultOnError(error, type) {
  console.error(`SessionManager: failed to persist ${type}: ${error.message}`);
}

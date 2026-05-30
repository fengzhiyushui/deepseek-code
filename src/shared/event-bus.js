import { EventEmitter } from "node:events";
import { makeId } from "./id.js";
import { nowIso } from "./time.js";

export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);

  function publish(eventType, data = {}) {
    if (!eventType || typeof eventType !== "string") {
      throw new Error("eventType must be a non-empty string");
    }

    const meta = {
      event_id: makeId("evt"),
      event_type: eventType,
      timestamp: nowIso()
    };

    for (const handler of emitter.rawListeners(eventType)) {
      try {
        handler(data, meta);
      } catch {
        // subscriber failure isolated
      }
    }
  }

  function subscribe(eventType, handler) {
    if (typeof handler !== "function") {
      throw new Error("event handler must be a function");
    }
    emitter.on(eventType, handler);
    return {
      unsubscribe() {
        emitter.off(eventType, handler);
      }
    };
  }

  function once(eventType, handler) {
    if (typeof handler !== "function") {
      throw new Error("event handler must be a function");
    }
    emitter.once(eventType, handler);
    return {
      unsubscribe() {
        emitter.off(eventType, handler);
      }
    };
  }

  return { publish, subscribe, once };
}

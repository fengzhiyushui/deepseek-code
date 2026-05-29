// src/kernel/event-bus.js
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);
  // High limit intentional: Phase 1+ modules (Orchestrator, Context, Permissions)
  // each subscribe to multiple event types. Default 10 is insufficient.
  // Leak detection will move to a dedicated health-check API in Phase 2.

  function publish(eventType, data) {
    const meta = {
      event_id: `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      event_type: eventType,
      timestamp: new Date().toISOString()
    };
    const listeners = emitter.rawListeners(eventType);
    for (const handler of listeners) {
      try {
        handler(data, meta);
      } catch (error) {
        // Isolate handler failures so one broken subscriber
        // does not prevent others from receiving the event.
        // In Phase 1+, errors will be published to a dedicated error event.
      }
    }
  }

  function subscribe(eventType, handler) {
    emitter.on(eventType, handler);
    return {
      unsubscribe() {
        emitter.off(eventType, handler);
      }
    };
  }

  function once(eventType, handler) {
    emitter.once(eventType, handler);
    return {
      unsubscribe() {
        emitter.off(eventType, handler);
      }
    };
  }

  return { publish, subscribe, once };
}

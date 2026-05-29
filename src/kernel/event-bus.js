// src/kernel/event-bus.js
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(200);

  function publish(eventType, data) {
    const meta = {
      event_id: `evt_${randomUUID().slice(0, 12)}`,
      event_type: eventType,
      timestamp: new Date().toISOString()
    };
    emitter.emit(eventType, data, meta);
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

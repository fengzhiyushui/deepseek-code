// src/kernel/session-manager.js

export function createSessionManager({ eventBus, sessionLog }) {

  function bridge(eventTypes) {
    if (!sessionLog) return { unsubscribe() {}, flush: async () => {} };

    let pending = 0;
    let resolveIdle;
    let idlePromise = Promise.resolve();

    const handlers = [];
    for (const eventType of eventTypes) {
      const sub = eventBus.subscribe(eventType, (data, meta) => {
        pending++;
        idlePromise = new Promise((r) => { resolveIdle = r; });
        sessionLog.append(eventType, data).then(() => {
          pending--;
          if (pending === 0 && resolveIdle) resolveIdle();
        }).catch((err) => {
          pending--;
          if (pending === 0 && resolveIdle) resolveIdle();
          console.error(`SessionManager: failed to persist ${eventType}: ${err.message}`);
        });
      });
      handlers.push(sub);
    }

    return {
      unsubscribe() {
        for (const h of handlers) h.unsubscribe();
      },
      async flush() {
        if (pending === 0) return;
        await idlePromise;
      }
    };
  }

  async function getTimeline(count = 20) {
    if (!sessionLog) return [];
    const events = await sessionLog.tail(count);
    return events;
  }

  return { bridge, getTimeline };
}

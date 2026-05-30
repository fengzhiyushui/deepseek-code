import { createEventBus } from "./shared/event-bus.js";
import { createAgentRuntime } from "./core/runtime/agent-runtime.js";
import { SESSION_EVENT_TYPES } from "./sessions/event-types.js";

export async function createKernel(root, options = {}) {
  const eventBus = options.eventBus || createEventBus();
  const sessionId = options.sessionId || `sess_${Date.now()}`;
  const runtime = createAgentRuntime({
    eventBus,
    sessionId,
    modelGateway: options.modelGateway || null
  });

  const session = {
    subscribe(handler) {
      if (typeof handler !== "function") {
        throw new Error("session subscriber must be a function");
      }

      const subscriptions = SESSION_EVENT_TYPES.map((type) =>
        eventBus.subscribe(type, (data, meta) => {
          handler({ ...data, type, meta });
        })
      );

      return {
        unsubscribe() {
          for (const sub of subscriptions) {
            sub.unsubscribe();
          }
        }
      };
    },

    async getTimeline() {
      return [];
    },

    async resume(resumeSessionId = sessionId) {
      eventBus.publish("session:resume", {
        session_id: resumeSessionId,
        root
      });
    }
  };

  const context = {
    async snapshot() {
      return {
        snapshot_id: "v2_empty_snapshot",
        root,
        units: [],
        budget: { allocated: 0, used: 0 }
      };
    },
    pin(path) {
      eventBus.publish("context:pin", { path });
    },
    unpin(path) {
      eventBus.publish("context:unpin", { path });
    }
  };

  const config = {
    getPublicConfig() {
      return {
        runtime: "v2",
        root,
        has_api_key: false
      };
    },
    updateProjectConfig() {
      throw new Error("project config updates are not available in V2-0");
    }
  };

  return {
    root,
    eventBus,
    runtime,
    agent: {
      send: runtime.send,
      approve: runtime.approve,
      interrupt: runtime.interrupt
    },
    session,
    context,
    config
  };
}

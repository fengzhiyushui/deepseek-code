// src/kernel/kernel-api.js
import { createEventBus } from "./event-bus.js";
import { loadConfig } from "./config-provider.js";
import { createModelProvider } from "./model-provider.js";
import { createContextEngine } from "./context-engine.js";
import { createTaskOrchestrator } from "./task-orchestrator.js";

export async function createKernel(root, options = {}) {
  const eventBus = createEventBus();
  const config = await loadConfig(root, options.config);

  // Phase 1: real modules
  const modelProvider = createModelProvider(config);
  const contextEngine = createContextEngine(root);

  // Scan project on startup
  await contextEngine.scan();

  const orchestrator = createTaskOrchestrator({
    eventBus,
    modelProvider,
    contextEngine
  });

  const session = {
    subscribe(handler) {
      return eventBus.subscribe("orchestrator:state", (data) => {
        handler({ type: "orchestrator:state", ...data });
      });
    },

    getTimeline(count = 20) {
      // Phase 3+: read from SessionLog
      return Promise.resolve([]);
    },

    async resume() {
      eventBus.publish("session:resume", { timestamp: new Date().toISOString() });
    }
  };

  const agent = {
    async send(message, opts = {}) {
      return orchestrator.submit(message, opts);
    },

    approve(id, decision) {
      orchestrator.approve(id, decision);
      eventBus.publish("permission:decision", { tool_call_id: id, decision });
    },

    interrupt() {
      orchestrator.interrupt();
      eventBus.publish("agent:interrupt", { timestamp: new Date().toISOString() });
    }
  };

  const context = {
    async getSnapshot(phase = "general", channel = "think") {
      return contextEngine.snapshot(phase, channel);
    },

    pin(filePath) {
      contextEngine.pin(filePath);
      eventBus.publish("context:pin", { path: filePath });
    },

    unpin(filePath) {
      contextEngine.unpin(filePath);
      eventBus.publish("context:unpin", { path: filePath });
    }
  };

  return {
    eventBus,
    config,
    modelProvider,
    contextEngine,
    orchestrator,
    session,
    agent,
    context
  };
}

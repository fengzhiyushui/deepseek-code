// src/kernel/kernel-api.js
import { createEventBus } from "./event-bus.js";
import { loadConfig } from "./config-provider.js";
import { createModelProvider } from "./model-provider.js";
import { createContextEngine } from "./context-engine.js";
import { createTaskOrchestrator } from "./task-orchestrator.js";
import { createSessionManager } from "./session-manager.js";
import { createSessionLog } from "./session-log.js";
import os from "node:os";
import path from "node:path";

export async function createKernel(root, options = {}) {
  const eventBus = createEventBus();
  const config = await loadConfig(root, options.config);

  // Phase 1: real modules
  const modelProvider = createModelProvider(config);
  const contextEngine = createContextEngine(root);
  await contextEngine.scan();

  const orchestrator = createTaskOrchestrator({
    eventBus,
    modelProvider,
    contextEngine
  });

  // Phase 3: session persistence
  const sessionDir = options.sessionDir || path.join(os.homedir(), ".deepseek-code");
  const projectId = Buffer.from(root).toString("base64").slice(0, 16).replace(/[/+=]/g, "_");
  const sessionId = `sess_${Date.now()}`;

  let sessionLog = null;
  try {
    sessionLog = await createSessionLog(sessionDir, projectId, sessionId, {
      mode: "kernel",
      cwd: root,
      config_id: "cfg_v1"
    });
  } catch (err) {
    console.error(`SessionManager: failed to create session log: ${err.message}`);
  }

  const sessionManager = createSessionManager({ eventBus, sessionLog });

  // Bridge essential events to persistent log
  const BRIDGED_EVENTS = [
    "orchestrator:state",
    "user:message",
    "tool:call",
    "tool:result",
    "permission:decision"
  ];
  sessionManager.bridge(BRIDGED_EVENTS);

  const session = {
    subscribe(handler) {
      const unsubs = [];
      for (const eventType of BRIDGED_EVENTS) {
        unsubs.push(eventBus.subscribe(eventType, (data) => {
          handler({ type: eventType, ...data });
        }));
      }
      return {
        unsubscribe() {
          for (const u of unsubs) u.unsubscribe();
        }
      };
    },

    async getTimeline(count = 20) {
      return sessionManager.getTimeline(count);
    },

    async resume() {
      eventBus.publish("session:resume", { timestamp: new Date().toISOString() });
    }
  };

  const agent = {
    async send(message, opts = {}) {
      // Publish user message FIRST so session log / timeline capture it
      eventBus.publish("user:message", {
        content: message,
        options: opts
      });
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
    sessionManager,
    session,
    agent,
    context
  };
}

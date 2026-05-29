// src/kernel/kernel-api.js
import { createEventBus } from "./event-bus.js";
import { loadConfig } from "./config-provider.js";

/**
 * Create the Kernel instance — the single entry point for CLI, TUI, and GUI.
 *
 * The Kernel composes the EventBus, loads configuration, and exposes
 * the public API contract that all UI shells consume.
 *
 * Phase 0 scope:
 *   - EventBus (inter-module communication)
 *   - Config (three-tier merge with ModelProfiles)
 *   - Session subscription (pass-through to SessionLog, wired in Phase 1+)
 *
 * Later phases extend this Kernel with:
 *   - agent: { send, approve, interrupt }
 *   - context: { getSnapshot, pin, unpin }
 *   - session: { getTimeline, resume }
 */
export async function createKernel(root, options = {}) {
  const eventBus = createEventBus();
  const config = await loadConfig(root, options.config);

  // Phase 0: session subscription is a pass-through to EventBus.
  // Phase 1+ will wire in SessionLog persistence.
  const session = {
    subscribe(handler) {
      // Phase 3+: wire to SessionLog event stream via a subscriber registry.
      // EventBus does not have wildcards; session subscriber will be
      // explicitly called from each event publish site in Phase 1+.
      // For now, return a no-op unsubscribe handle.
      return { unsubscribe() {} };
    },

    getTimeline(count = 20) {
      // Phase 1+: read from SessionLog
      return Promise.resolve([]);
    },

    async resume() {
      // Phase 3+: replay event log and restore state
      eventBus.publish("session:resume", { timestamp: new Date().toISOString() });
    }
  };

  // agent stub — full implementation in Phase 1 (Task Orchestrator)
  const agent = {
    async send(message, opts = {}) {
      eventBus.publish("user:message", {
        content: message,
        options: opts
      });
      throw new Error("Agent not yet implemented. Coming in Phase 1.");
    },

    approve(id, decision) {
      eventBus.publish("permission:decision", {
        tool_call_id: id,
        decision
      });
    },

    interrupt() {
      eventBus.publish("agent:interrupt", {
        timestamp: new Date().toISOString()
      });
    }
  };

  // context stub — full implementation in Phase 1 (Context Engine)
  const context = {
    async getSnapshot() {
      return { units: [], budget: { allocated: 0, used: 0 } };
    },

    pin(filePath) {
      eventBus.publish("context:pin", { path: filePath });
    },

    unpin(filePath) {
      eventBus.publish("context:unpin", { path: filePath });
    }
  };

  return {
    eventBus,
    config,
    session,
    agent,
    context
  };
}

import { createEventBus } from "./shared/event-bus.js";
import { createAgentRuntime } from "./core/runtime/agent-runtime.js";
import { SESSION_EVENT_TYPES } from "./sessions/event-types.js";
import { createDeepSeekGateway } from "./deepseek/model-gateway.js";

export async function createKernel(root, options = {}) {
  const eventBus = options.eventBus || createEventBus();
  const sessionId = options.sessionId || `sess_${Date.now()}`;
  const modelGateway = resolveModelGateway(options);
  const runtime = createAgentRuntime({ eventBus, sessionId, modelGateway });
  const session = {
    subscribe(handler) {
      if (typeof handler !== "function") throw new Error("session subscriber must be a function");
      const subs = SESSION_EVENT_TYPES.map((type) => eventBus.subscribe(type, (data, meta) => { handler({ ...data, type, meta }); }));
      return { unsubscribe() { for (const s of subs) s.unsubscribe(); } };
    },
    async getTimeline() { return []; },
    async resume(id = sessionId) { eventBus.publish("session:resume", { session_id: id, root }); }
  };
  const context = {
    async snapshot() { return { snapshot_id: "v2_empty_snapshot", root, units: [], budget: { allocated: 0, used: 0 } }; },
    pin(p) { eventBus.publish("context:pin", { path: p }); },
    unpin(p) { eventBus.publish("context:unpin", { path: p }); }
  };
  const config = {
    getPublicConfig() {
      return { runtime: "v2", root, has_api_key: Boolean(options.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY) };
    },
    updateProjectConfig() { throw new Error("project config updates are not available in V2-1"); }
  };
  return { root, eventBus, runtime, agent: { send: runtime.send, approve: runtime.approve, interrupt: runtime.interrupt }, session, context, config };
}

function resolveModelGateway(options) {
  if (options.modelGateway) return options.modelGateway;
  if (options.deepseek || process.env.DEEPSEEK_API_KEY) return createDeepSeekGateway(options.deepseek || {});
  return null;
}

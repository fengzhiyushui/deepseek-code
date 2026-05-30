import path from "node:path";
import { createEventBus } from "./shared/event-bus.js";
import { makeId } from "./shared/id.js";
import { createAgentRuntime } from "./core/runtime/agent-runtime.js";
import { SESSION_EVENT_TYPES } from "./sessions/event-types.js";
import { createSessionEventLog, projectIdFromRoot } from "./sessions/event-log.js";
import { createSessionManager } from "./sessions/session-manager.js";
import { createDeepSeekGateway } from "./deepseek/model-gateway.js";
import { createEditService } from "./edits/edit-service.js";
import { createBuiltinTools } from "./tools/builtin/index.js";
import { createToolRegistry } from "./tools/registry.js";
import { createToolExecutor } from "./tools/executor.js";
import { createPermissionEngine } from "./tools/permissions/permission-engine.js";
import { createApprovalCache } from "./tools/permissions/approval-cache.js";
import { createPolicyContext } from "./tools/permissions/policy-loader.js";

export async function createKernel(root, options = {}) {
  const eventBus = options.eventBus || createEventBus();
  const sessionId = options.sessionId || makeId("sess");
  const projectId = options.projectId || projectIdFromRoot(root);
  const sessionRoot = options.sessionRoot || path.join(root, ".deepseek-code", "v2", "sessions");
  const sessionLog = options.sessionLog === null
    ? null
    : options.sessionLog || (!options.sessionManager
        ? await createSessionEventLog({
            sessionRoot,
            projectId,
            sessionId,
            meta: { root, runtime: "v2" }
          })
        : null);
  const sessionManager = options.sessionManager || createSessionManager({
    eventBus,
    eventLog: sessionLog,
    eventTypes: SESSION_EVENT_TYPES
  });
  const modelGateway = resolveModelGateway(options);
  const approvalCache = options.approvalCache || createApprovalCache();
  const permissionEngine = options.permissionEngine || createPermissionEngine();
  const editService = options.editService || createEditService({
    projectRoot: root,
    eventBus
  });
  const toolRegistry = options.toolRegistry || createToolRegistry({
    tools: createBuiltinTools({
      editService,
      webFetch: options.webFetch || {}
    })
  });
  const toolExecutor = options.toolExecutor || createToolExecutor({
    registry: toolRegistry,
    permissionEngine,
    eventBus
  });
  const runtime = createAgentRuntime({
    eventBus,
    sessionId,
    modelGateway,
    toolSchemas: () => toolRegistry.toDeepSeekTools(),
    executeTool: (toolCall, policyContext) => toolExecutor.execute(toolCall, policyContext),
    createPolicyContext: (executionOptions = {}) => createPolicyContext({
      autonomy: executionOptions.autonomy || "gated",
      projectId: executionOptions.projectId || sessionId,
      projectRoot: root,
      trustStore: options.trustStore || { rules: [] },
      projectRules: options.projectRules || [],
      approvalCache,
      memoryRoot: options.memoryRoot || null,
      turnId: executionOptions.turnId
    })
  });

  const session = {
    subscribe: sessionManager.subscribe,
    getTimeline: sessionManager.getTimeline,
    flush: sessionManager.flush,
    async resume(id = sessionId) {
      eventBus.publish("session:resume", { session_id: id, root });
      await sessionManager.flush();
    },
    dispose: sessionManager.dispose
  };

  const context = {
    async snapshot() {
      return { snapshot_id: "v2_empty_snapshot", root, units: [], budget: { allocated: 0, used: 0 } };
    },
    pin(p) { eventBus.publish("context:pin", { path: p }); },
    unpin(p) { eventBus.publish("context:unpin", { path: p }); }
  };

  const config = {
    getPublicConfig() {
      return { runtime: "v2", root, has_api_key: Boolean(options.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY) };
    },
    updateProjectConfig() { throw new Error("project config updates are not available in V2-2"); }
  };

  const tools = {
    list(filter = {}) {
      return toolRegistry.listTools(filter);
    },
    schemas(filter = {}) {
      return toolRegistry.toDeepSeekTools(filter);
    },
    async execute(toolCall, executionOptions = {}) {
      const policyContext = createPolicyContext({
        autonomy: executionOptions.autonomy || "gated",
        projectId: executionOptions.projectId || sessionId,
        projectRoot: root,
        trustStore: options.trustStore || { rules: [] },
        projectRules: options.projectRules || [],
        approvalCache,
        memoryRoot: options.memoryRoot || null,
        turnId: executionOptions.turnId
      });
      policyContext.turnId = executionOptions.turnId;
      return toolExecutor.execute(toolCall, policyContext);
    }
  };

  return {
    root,
    eventBus,
    runtime,
    agent: { send: runtime.send, approve: runtime.approve, interrupt: runtime.interrupt },
    session,
    sessionManager,
    context,
    config,
    tools
  };
}

function resolveModelGateway(options) {
  if (options.modelGateway) return options.modelGateway;
  if (options.deepseek || process.env.DEEPSEEK_API_KEY) return createDeepSeekGateway(options.deepseek || {});
  return null;
}

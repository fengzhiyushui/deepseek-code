import path from "node:path";
import { createEventBus } from "./shared/event-bus.js";
import { makeId } from "./shared/id.js";
import { createAgentRuntime } from "./core/runtime/agent-runtime.js";
import { SESSION_EVENT_TYPES } from "./sessions/event-types.js";
import { createSessionEventLog, projectIdFromRoot } from "./sessions/event-log.js";
import { createSessionManager } from "./sessions/session-manager.js";
import { createBranchStore } from "./sessions/branch-store.js";
import { createRewindService } from "./sessions/rewind-service.js";
import { buildCheckpointIndex } from "./sessions/checkpoint-index.js";
import { createDeepSeekGateway } from "./deepseek/model-gateway.js";
import { createEditService } from "./edits/edit-service.js";
import { createBuiltinTools } from "./tools/builtin/index.js";
import { createToolRegistry } from "./tools/registry.js";
import { createToolExecutor } from "./tools/executor.js";
import { createPermissionEngine } from "./tools/permissions/permission-engine.js";
import { createApprovalCache } from "./tools/permissions/approval-cache.js";
import { createPolicyContext } from "./tools/permissions/policy-loader.js";
import { createContextEngine } from "./context/index.js";

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
  const branchStore = options.branchStore !== undefined
    ? options.branchStore
    : (sessionLog !== null ? await createBranchStore({
        sessionRoot,
        projectId,
        sessionId
      }) : null);
  let activeBranchId = branchStore ? await branchStore.getActiveBranchId() : "br_main";
  const sessionManager = options.sessionManager || createSessionManager({
    eventBus,
    eventLog: sessionLog,
    eventTypes: SESSION_EVENT_TYPES,
    getActiveBranchId: () => activeBranchId,
    getBranchAncestry: (branchId) => branchStore ? branchStore.getAncestry(branchId) : Promise.resolve([{ branch_id: branchId || "br_main", forked_from_seq: 0 }])
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
    eventBus,
    defaultToolTimeoutMs: options.limits?.toolTimeoutMs ?? null
  });
  const contextEngine = options.contextEngine || createContextEngine({
    root,
    eventBus,
    options: options.context || {}
  });
  if (!options.contextEngine) {
    await contextEngine.scan();
  }

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
    }),
    verifyMode: options.verifyMode || "auto",
    testArgv: options.testArgv || null,
    maxRepairAttempts: options.maxRepairAttempts ?? 2,
    createContextSnapshot: (input) => contextEngine.snapshot(input),
    maxTurnTokens: options.limits?.maxTurnTokens ?? null,
    maxModelCalls: options.limits?.maxModelCalls ?? null,
    modelTimeoutMs: options.limits?.modelTimeoutMs ?? null,
    maxToolCallRepairs: options.limits?.maxToolCallRepairs ?? 0,
    grantApprovalForToolCall: async (toolCall, approvalContext = {}) => {
      const securedCall = toolRegistry.secureToolCall(toolCall);
      const policyContext = createPolicyContext({
        autonomy: approvalContext.options?.autonomy || "supervised",
        projectId: approvalContext.options?.projectId || sessionId,
        projectRoot: root,
        trustStore: options.trustStore || { rules: [] },
        projectRules: options.projectRules || [],
        approvalCache,
        memoryRoot: options.memoryRoot || null,
        turnId: approvalContext.turnId
      });
      const fp = permissionEngine.fingerprint(securedCall, policyContext);
      approvalCache.grant(fp, { decision: "allow" });
    }
  });

  const branches = branchStore ? {
    list: () => branchStore.listBranches(),
    async getActive() {
      return branchStore.getBranch(activeBranchId);
    },
    async create(input = {}) {
      return branchStore.createBranch(input);
    },
    async activate(branch_id) {
      const branch = await branchStore.activateBranch(branch_id);
      activeBranchId = branch.branch_id;
      eventBus.publish("session:branch_activated", {
        branch_id: branch.branch_id,
        parent_branch_id: branch.parent_branch_id
      });
      await sessionManager.flush();
      return branch;
    }
  } : {
    list: async () => [],
    getActive: async () => ({ branch_id: "br_main", parent_branch_id: null, forked_from_event_id: null, forked_from_seq: 0, forked_from_turn_id: null, created_at: new Date().toISOString(), label: "main" }),
    create: async () => { throw new Error("branch store unavailable"); },
    activate: async () => { throw new Error("branch store unavailable"); }
  };

  const rewind = branchStore ? createRewindService({
    eventBus,
    projectRoot: root,
    getTimeline: (input) => sessionManager.getTimeline(input),
    getActiveBranchId: async () => activeBranchId,
    createBranch: (input) => branches.create(input),
    activateBranch: (branchId) => branches.activate(branchId),
    rollback: (input) => editService.rollback(input)
  }) : {
    preview: async () => { throw new Error("rewind unavailable: no branch store"); },
    apply: async () => { throw new Error("rewind unavailable: no branch store"); }
  };

  const checkpoints = {
    async list({ branch_id = activeBranchId } = {}) {
      const timeline = await sessionManager.getTimeline({ count: 10000, branch_id });
      return buildCheckpointIndex(timeline, { branch_id }).checkpoints;
    }
  };

  const session = {
    subscribe: sessionManager.subscribe,
    getTimeline: sessionManager.getTimeline,
    flush: sessionManager.flush,
    async resume(id = sessionId) {
      eventBus.publish("session:resume", { session_id: id, root });
      await sessionManager.flush();
    },
    dispose: sessionManager.dispose,
    branches,
    rewind,
    checkpoints
  };

  const context = {
    snapshot: (input = {}) => contextEngine.snapshot(input),
    pin: (p) => contextEngine.pin(p),
    unpin: (p) => contextEngine.unpin(p),
    warm: (p, reason) => contextEngine.warm(p, reason),
    getStats: () => contextEngine.getStats()
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
    tools,
    metrics: {
      getUsage() {
        return modelGateway?.getUsageStats?.() || zeroUsage();
      },
      getContext() {
        return contextEngine.getStats();
      },
      getSnapshot: async (input = {}) => {
        const snap = await contextEngine.snapshot(input);
        return redactSnapshot(snap);
      }
    }
  };
}

function redactSnapshot(snap) {
  const { summary, ...rest } = snap;
  const cleanUnits = (snap.units || []).map((unit) => {
    const { snippet, ...restUnit } = unit;
    return restUnit;
  });
  return { ...rest, summary: undefined, units: cleanUnits };
}

function zeroUsage() {
  return {
    requests: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_reasoning_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    cache_hit_rate: 0,
    avg_latency_ms: 0,
    by_channel: {},
    by_model: {}
  };
}

function resolveModelGateway(options) {
  if (options.modelGateway) return options.modelGateway;
  if (options.deepseek || process.env.DEEPSEEK_API_KEY) return createDeepSeekGateway(options.deepseek || {});
  return null;
}

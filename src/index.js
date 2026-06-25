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
import { createPausedTurnPersistence } from "./core/recovery/paused-turn-persistence.js";
import { createRecoveryInbox } from "./core/recovery/recovery-inbox.js";
import { createRecoveryService } from "./core/recovery/recovery-service.js";
import { acquireProjectLock } from "./core/recovery/project-lock.js";
import { createTransactionJournal } from "./core/recovery/transaction-journal.js";

export async function createKernel(root, options = {}) {
  const eventBus = options.eventBus || createEventBus();
  const sessionId = options.sessionId || makeId("sess");
  const projectId = options.projectId || projectIdFromRoot(root);
  const sessionRoot = options.sessionRoot || path.join(root, ".deepseek-code", "v2", "sessions");
  // Recovery is opt-in (default off), consistent with the V2-20 guardrail
  // pattern: the kernel primitive stays a mechanism; the config layer decides
  // policy. Enable durable recovery via createKernel(root, { recovery: { enabled: true } }).
  const recoveryEnabled = options.recovery?.enabled === true;

  // Acquire project lock if recovery enabled
  const projectLock = recoveryEnabled && options.recovery?.lock !== false
    ? await acquireProjectLock({
        root,
        surface: options.recovery?.surface || "cli",
        sessionId,
        interactive: options.recovery?.interactive !== false,
        takeover: options.recovery?.takeover || null,
        faults: options.recovery?.faults || options.recoveryFaults
      }).catch((error) => {
        // In test environments with temporary directories, allow lock bypass on conflict
        if (error?.code === "RECOVERY_LOCK_HELD" && options.recovery?.lockFailureMode === "warn") {
          return { assertOwner: async () => {}, epoch: 1, release: async () => {} };
        }
        throw error;
      })
    : null;

  const pausedTurnPersistence = recoveryEnabled
    ? createPausedTurnPersistence({ root, projectId, faults: options.recovery?.faults || options.recoveryFaults })
    : null;
  let kernelDisposed = false;

  const recoveryInbox = recoveryEnabled
    ? createRecoveryInbox({ root })
    : null;
  const transactionJournal = recoveryEnabled
    ? createTransactionJournal({ root, projectId, faults: options.recovery?.faults || options.recoveryFaults })
    : null;
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
    eventBus,
    recoveryJournal: transactionJournal,
    assertOwner: projectLock ? () => projectLock.assertOwner() : async () => {}
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
    projectId,
    projectRoot: root,
    trustStore: options.trustStore || { rules: [] },
    projectRules: options.projectRules || [],
    memoryRoot: options.memoryRoot || null,
    recoverySurface: options.recovery?.surface || "cli",
    pausedTurnPersistence,
    flushEvents: () => sessionManager.flush(),
    modelGateway,
    toolSchemas: () => toolRegistry.toDeepSeekTools(),
    executeTool: (toolCall, policyContext) => toolExecutor.execute(toolCall, policyContext),
    createPolicyContext: (executionOptions = {}) => {
      const context = createPolicyContext({
        autonomy: executionOptions.autonomy || "gated",
        projectId: executionOptions.projectId || projectId,
        projectRoot: executionOptions.projectRoot || root,
        trustStore: executionOptions.trustStore || options.trustStore || { rules: [] },
        projectRules: executionOptions.projectRules || options.projectRules || [],
        approvalCache,
        memoryRoot: "memoryRoot" in executionOptions ? executionOptions.memoryRoot : (options.memoryRoot || null)
      });
      context.turnId = executionOptions.turnId;
      context.toolCall = executionOptions.toolCall;
      context.phase = executionOptions.phase;
      return context;
    },
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
      const permissionContext = approvalContext.permission_context || approvalContext.options?.permission_context || null;
      const policyContext = createPolicyContext({
        autonomy: permissionContext?.autonomy || approvalContext.options?.autonomy || "supervised",
        projectId: permissionContext?.project_id || approvalContext.options?.projectId || projectId,
        projectRoot: permissionContext?.project_root || root,
        trustStore: permissionContext ? { rules: permissionContext.trust_store_rules || [] } : (options.trustStore || { rules: [] }),
        projectRules: permissionContext?.project_rules || options.projectRules || [],
        approvalCache,
        memoryRoot: permissionContext?.memory_root ?? options.memoryRoot ?? null
      });
      policyContext.turnId = approvalContext.turnId;
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
    rollback: (input) => editService.rollback(input),
    recoveryJournal: transactionJournal,
    assertOwner: projectLock ? () => projectLock.assertOwner() : async () => {}
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

  const recovery = recoveryEnabled && !options.recovery?.skipStartupRecovery
    ? await createRecoveryServiceFacade({
        projectId,
        projectLock,
        pausedTurnPersistence,
        recoveryInbox,
        runtime,
        sessionManager,
        eventBus,
        options,
        transactionJournal
      })
    : disabledRecoveryFacade();

  return {
    root,
    eventBus,
    runtime,
    agent: {
      send: runtime.send,
      approve: runtime.approve,
      interrupt: runtime.interrupt,
      listPaused: runtime.listPaused,
      cancelPaused: runtime.cancelPaused
    },
    recovery,
    session,
    sessionManager,
    context,
    config,
    tools,
    async dispose() {
      if (kernelDisposed) return;
      kernelDisposed = true;
      try { sessionManager.dispose?.(); } catch { /* best-effort */ }
      try { await projectLock?.release?.(); } catch { /* best-effort */ }
    },
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

async function createRecoveryServiceFacade({
  projectId,
  projectLock,
  pausedTurnPersistence,
  recoveryInbox,
  runtime,
  sessionManager,
  eventBus,
  options,
  transactionJournal
}) {
  const recoveryService = createRecoveryService({
    projectId,
    lock: projectLock || { assertOwner: async () => {}, epoch: 0 },
    paused: pausedTurnPersistence,
    pausedTurnStore: {
      restore: runtime.restorePaused,
      list: runtime.listPaused
    },
    inbox: recoveryInbox,
    appendMarker: async (type, data) => {
      eventBus.publish(type, data);
      await sessionManager.flush();
    },
    resumePaused: async (approvalId, decision) => runtime.approve(approvalId, decision),
    cancelPaused: async (approvalId) => runtime.cancelPaused(approvalId),
    transactionJournal
  });

  if (!options.recovery?.skipStartupRecovery) {
    await recoveryService.recoverOnStartup();
  }

  return {
    list: (opts) => recoveryService.list(opts),
    resume: (id, opts) => recoveryService.resume(id, opts),
    cancel: (id) => recoveryService.cancel(id),
    clear: (id) => recoveryService.clear(id),
    abortJournal: (id) => recoveryService.abortJournal(id),
    commitJournal: (id) => recoveryService.commitJournal(id),
    report: () => recoveryService.report()
  };
}

function createPausedRecoveryFacade({ runtime, pausedTurnPersistence }) {
  let lastReport = { found: [], done: [], blocked: [], next: [] };

  async function rehydratePausedSidecars() {
    if (!pausedTurnPersistence?.scan) return [];
    const scanned = await pausedTurnPersistence.scan();
    const current = new Set(runtime.listPaused().map((record) => record.approval_id));
    for (const record of scanned) {
      if (record.status || current.has(record.approval_id)) continue;
      runtime.restorePaused(record);
      current.add(record.approval_id);
    }
    return scanned;
  }

  return {
    async list() {
      const scanned = await rehydratePausedSidecars();
      const corruptItems = scanned
        .filter((item) => item.status === "corrupt")
        .map(corruptSidecarToRecoveryItem);
      const pausedItems = runtime.listPaused().map(pausedRecordToRecoveryItem);
      const items = [...pausedItems, ...corruptItems].sort((left, right) => {
        const byCreated = String(left.created_at || "").localeCompare(String(right.created_at || ""));
        return byCreated || String(left.id).localeCompare(String(right.id));
      });
      lastReport = {
        found: items,
        done: [],
        blocked: corruptItems,
        next: items.map((item) => ({ id: item.id, allowed_actions: item.allowed_actions || [] }))
      };
      return items;
    },
    async resume(id, { decision = "approve" } = {}) {
      await rehydratePausedSidecars();
      const approvalId = approvalIdFromRecoveryId(id);
      const result = await runtime.approve(approvalId, decision);
      return { status: "resumed", approval_id: approvalId, result };
    },
    async cancel(id, reason = "cancelled") {
      const scanned = await rehydratePausedSidecars();
      const approvalId = approvalIdFromRecoveryId(id);
      const record = await runtime.cancelPaused(approvalId, reason);
      if (record) {
        return { status: "cancelled", item: pausedRecordToRecoveryItem(record) };
      }
      const corrupt = scanned.find((item) => item.status === "corrupt" && item.approval_id === approvalId);
      if (corrupt && pausedTurnPersistence?.quarantine) {
        return pausedTurnPersistence.quarantine(approvalId, reason);
      }
      return null;
    },
    async clear() {
      throw Object.assign(new Error("recovery clear is not available for paused approvals yet"), { code: "RECOVERY_CLEAR_UNAVAILABLE" });
    },
    report() {
      return lastReport;
    }
  };
}

function disabledRecoveryFacade() {
  return {
    list: async () => [],
    resume: async () => { throw Object.assign(new Error("recovery is disabled"), { code: "RECOVERY_DISABLED" }); },
    cancel: async () => { throw Object.assign(new Error("recovery is disabled"), { code: "RECOVERY_DISABLED" }); },
    clear: async () => { throw Object.assign(new Error("recovery is disabled"), { code: "RECOVERY_DISABLED" }); },
    report: () => ({ found: [], done: [], blocked: [], next: [] })
  };
}

function pausedRecordToRecoveryItem(record) {
  const permissionContext = record.permission_context || record.resume_state?.permission_context || {};
  return {
    id: `rec_pause_${record.approval_id}`,
    type: "paused_turn",
    status: "pending",
    source_id: record.approval_id,
    summary: record.approval?.summary || "Approval paused",
    metadata: {
      autonomy: permissionContext.autonomy || record.turn?.autonomy || "gated",
      surface: record.surface || "unknown",
      turn_id: record.turn_id,
      session_id: record.session_id || record.turn?.session_id || null
    },
    allowed_actions: ["resume", "cancel"],
    created_at: record.created_at || null,
    updated_at: record.created_at || null
  };
}

function corruptSidecarToRecoveryItem(item) {
  return {
    id: `rec_pause_${item.approval_id}`,
    type: "paused_turn",
    status: "blocked",
    source_id: item.approval_id,
    summary: "Paused approval sidecar is corrupt",
    metadata: { reason: item.reason },
    allowed_actions: ["cancel"],
    created_at: null,
    updated_at: null
  };
}

function approvalIdFromRecoveryId(id) {
  const value = String(id || "");
  return value.startsWith("rec_pause_") ? value.slice("rec_pause_".length) : value;
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

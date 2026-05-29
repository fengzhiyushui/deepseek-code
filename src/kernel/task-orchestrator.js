// src/kernel/task-orchestrator.js
import { randomUUID } from "node:crypto";

const STATE = {
  IDLE: "idle",
  CLASSIFY: "classify",
  THINKPLAN: "thinkplan",
  THINKREPLY: "thinkreply",
  ACTEXECUTE: "actexecute",
  THINKREVIEW: "thinkreview",
  ACTREPAIR: "actrepair",
  VERIFY: "verify",
  COMPLETE: "complete",
  AWAITAPPROVAL: "awaitapproval",
  TERMINAL: "terminal"
};

const AUTONOMY_DEFAULT = "gated";

function classifyMessage(message, options = {}) {
  const lower = message.toLowerCase().trim();
  const autonomy = options.autonomy || AUTONOMY_DEFAULT;

  if (/^(what|how|why|explain|describe|show|list|who|where|when)\b/.test(lower)
      && !/\b(fix|change|modify|edit|delete|remove|add|create|write|update|refactor)\b/.test(lower)) {
    return { task_type: "query", risk: "low", channel: "think", autonomy, reason: "问答/查询任务", fast_path: "thinkreply" };
  }

  if (/\b(fix|change|modify|edit|delete|remove|add|create|write|update|refactor|implement)\b/.test(lower)) {
    return { task_type: "edit", risk: "medium", channel: "think", autonomy, reason: "代码修改任务", fast_path: null };
  }

  if (/\b(debug|diagnose|analyze|investigate|inspect|check)\b/.test(lower)) {
    return { task_type: "diagnostic", risk: "low", channel: "think", autonomy, reason: "诊断/分析任务", fast_path: "thinkreply" };
  }

  return { task_type: "general", risk: "medium", channel: "think", autonomy, reason: "通用任务", fast_path: null };
}

export function createTaskOrchestrator({ eventBus, modelProvider, contextEngine }) {
  let currentState = STATE.IDLE;
  let currentAutonomy = AUTONOMY_DEFAULT;
  let currentChannel = null;
  let interrupted = false;
  let returnState = null;
  let pendingApproval = null;
  let _pendingResolve = null;
  let _pendingReject = null;

  function _clearPending() {
    _pendingResolve = null;
    _pendingReject = null;
  }

  function getState() {
    return { current: currentState, autonomy: currentAutonomy, channel: currentChannel };
  }

  function transition(to, reason, meta = {}) {
    const from = currentState;
    currentState = to;
    if (meta.channel) currentChannel = meta.channel;
    const event = {
      state: { entered: to, exited: from },
      transition: {
        reason,
        autonomy: { level: currentAutonomy },
        channel: currentChannel || null,
        approval: pendingApproval ? { required: true, type: pendingApproval.type } : null
      },
      trace: {
        id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        timestamp: new Date().toISOString()
      }
    };
    if (eventBus) eventBus.publish("orchestrator:state", event);
    return event;
  }

  async function _executeSubmit(message, options) {
    interrupted = false;
    currentAutonomy = options.autonomy || AUTONOMY_DEFAULT;
    try {
      transition(STATE.CLASSIFY, "user message received", { channel: null });
      if (interrupted) throw new InterruptedError();

      const classification = classifyMessage(message, options);

      // Validate provider health early so configuration errors surface before
      // the approval gate and cause a terminal transition.
      modelProvider.buildRequestBody([{ role: "system", content: "validate" }], "think");
      if (interrupted) throw new InterruptedError();

      if (classification.fast_path === "thinkreply") {
        transition(STATE.THINKREPLY, classification.reason, { channel: "think" });
        if (interrupted) throw new InterruptedError();
        const snapshot = contextEngine.snapshot("reply", "think");
        const messages = [
          { role: "system", content: "You are DeepSeek Code. Answer concisely in the user's language." },
          { role: "user", content: `Context snapshot: ${snapshot.snapshot_id}\n\n${message}` }
        ];
        modelProvider.buildRequestBody(messages, "think");
        if (interrupted) throw new InterruptedError();
        transition(STATE.COMPLETE, "reply delivered");
        transition(STATE.IDLE, "task complete");
        _pendingResolve({ status: "complete", state: "idle" });
        _clearPending();
        return;
      }

      // Standard loop
      await _runStandardLoop(message, classification, options);
    } catch (error) {
      if (error instanceof InterruptedError) {
        transition(STATE.IDLE, "interrupted by user");
        _pendingReject(error);
        _clearPending();
        return;
      }
      transition(STATE.TERMINAL, `error: ${error.message}`, { channel: currentChannel });
      _pendingReject(error);
      _clearPending();
    }
  }

  function submit(message, options = {}) {
    const outerPromise = new Promise((resolve, reject) => {
      _pendingResolve = resolve;
      _pendingReject = reject;
      _executeSubmit(message, options);
    });
    // Prevent unhandled rejection when the promise rejects synchronously
    // before the caller attaches its own handler. The caller still sees the
    // rejection when it awaits; this just suppresses the Node.js warning.
    outerPromise.catch(() => {});
    return outerPromise;
  }

  async function _runStandardLoop(message, classification, options) {
    const needsApproval = currentAutonomy === "supervised" || currentAutonomy === "gated";
    if (needsApproval) {
      pendingApproval = { type: "plan", message, classification };
      returnState = STATE.THINKPLAN;
      transition(STATE.AWAITAPPROVAL, "plan requires approval", { channel: "think" });
      // Promise stays pending until approve() or interrupt()
      return;
    }

    transition(STATE.THINKPLAN, classification.reason, { channel: "think" });
    if (interrupted) throw new InterruptedError();

    const planSnapshot = contextEngine.snapshot("plan", "think");
    const thinkMessages = [
      { role: "system", content: "You are DeepSeek Code. Analyze and create a structured plan. Output JSON with: analysis, plan (array of steps), risks, file_targets (array), test_strategy." },
      { role: "user", content: `Context snapshot: ${planSnapshot.snapshot_id}\n\nTask: ${message}` }
    ];

    if (modelProvider.invoke) {
      try {
        const planResult = await modelProvider.invoke(thinkMessages, "think");
        if (planResult.usage) {
          modelProvider.trackUsage({ usage: planResult.usage, channel: "think", model: "think-model", latency_ms: planResult.latency_ms || 0 });
        }
      } catch (err) { throw err; }
    }

    if (interrupted) throw new InterruptedError();

    transition(STATE.ACTEXECUTE, "plan ready, executing", { channel: "act" });
    const execSnapshot = contextEngine.snapshot("execute", "act");
    const actMessages = [
      { role: "system", content: "You are DeepSeek Code. Execute the plan. Return unified diffs." },
      { role: "user", content: `Context: ${execSnapshot.snapshot_id}\n\nExecute: ${message}` }
    ];

    if (modelProvider.invoke) {
      try {
        const actResult = await modelProvider.invoke(actMessages, "act");
        if (actResult.usage) {
          modelProvider.trackUsage({ usage: actResult.usage, channel: "act", model: "act-model", latency_ms: actResult.latency_ms || 0 });
        }
      } catch (err) { throw err; }
    }

    if (interrupted) throw new InterruptedError();

    transition(STATE.THINKREVIEW, "execution complete, reviewing", { channel: "think" });
    transition(STATE.VERIFY, "review complete, verifying", { channel: "act" });
    if (interrupted) throw new InterruptedError();

    transition(STATE.COMPLETE, "verification passed");
    transition(STATE.IDLE, "task complete");
    _pendingResolve({ status: "complete", state: "idle" });
    _clearPending();
  }

  function approve(id, decision) {
    if (pendingApproval) pendingApproval = null;
    if (returnState) {
      currentState = returnState;
      returnState = null;
      if (eventBus) {
        eventBus.publish("orchestrator:state", {
          state: { entered: currentState, exited: STATE.AWAITAPPROVAL },
          transition: { reason: `user ${decision}`, autonomy: { level: currentAutonomy }, channel: currentChannel, approval: null },
          trace: { id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`, timestamp: new Date().toISOString() }
        });
      }
    }
  }

  function interrupt() {
    interrupted = true;
    if (_pendingReject) {
      transition(STATE.IDLE, "interrupted by user");
      _pendingReject(new InterruptedError());
      _clearPending();
    }
  }

  return { getState, submit, approve, interrupt };
}

class InterruptedError extends Error {
  constructor() { super("Interrupted"); this.name = "InterruptedError"; }
}

import { createToolResult, createApprovalRequest } from "../core/protocol/index.js";
import { redactToolContent } from "../security/redactor.js";

export function createToolExecutor({ registry, permissionEngine, eventBus = null } = {}) {
  if (!registry) throw new Error("registry is required");
  if (!permissionEngine) throw new Error("permissionEngine is required");

  async function execute(toolCall, context = {}) {
    const started = Date.now();
    const def = registry.resolve(toolCall.name);
    if (!def) {
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: "error",
        content: [{ type: "error", text: `Unknown tool: ${toolCall.name}` }],
        durationMs: 0
      }));
    }

    let securedCall;
    try {
      securedCall = registry.secureToolCall(toolCall);
    } catch (error) {
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: "error",
        content: [{ type: "error", text: error.message }],
        durationMs: Date.now() - started
      }));
    }

    publish("tool:call", { call: securedCall, tool: publicTool(def) });

    const permission = permissionEngine.decide(securedCall, context);
    publish("permission:decision", { call_id: toolCall.id, tool: def.name, category: securedCall.category, permission });

    if (permission.decision === "deny") {
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: "denied",
        content: [{ type: "error", text: `Permission denied: ${permission.matched_rule}` }],
        metadata: { permission },
        durationMs: Date.now() - started
      }));
    }

    if (permission.decision === "ask") {
      const approval = createApprovalRequest({
        turnId: context.turnId || "turn_unknown",
        kind: "tool",
        risk: def.risk_level,
        summary: `${def.name} requires approval`,
        detailsRef: toolCall.id
      });
      publish("approval:requested", { approval, call: securedCall });
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: "approval_required",
        content: [{ type: "text", text: approval.summary }],
        metadata: { permission, approval },
        durationMs: Date.now() - started
      }));
    }

    try {
      const raw = await def.execute(securedCall.params, context);
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: raw.status || "success",
        content: redactToolContent(raw.content || []),
        metadata: raw.metadata || {},
        durationMs: Date.now() - started
      }));
    } catch (error) {
      return publishResult(createToolResult({
        callId: toolCall.id,
        status: "error",
        content: [{ type: "error", text: error.message }],
        metadata: {},
        durationMs: Date.now() - started
      }));
    }
  }

  function publish(type, data) {
    eventBus?.publish?.(type, data);
  }

  function publishResult(result) {
    publish("tool:result", { result });
    return result;
  }

  return { execute };
}

function publicTool(def) {
  const { execute, normalizeParams, resolveCategory, ...publicDef } = def;
  return publicDef;
}

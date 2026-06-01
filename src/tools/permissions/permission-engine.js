import { createHash } from "node:crypto";

export const DEFAULT_POLICY_MATRIX = Object.freeze({
  "read-only": {
    read: "allow", read_secret: "ask",
    write_create: "deny", write_update: "deny", write_delete: "deny",
    execute: "deny", network: "deny", destructive: "deny"
  },
  supervised: {
    read: "allow", read_secret: "ask",
    write_create: "ask", write_update: "ask", write_delete: "ask",
    execute: "ask", network: "ask", destructive: "deny"
  },
  gated: {
    read: "allow", read_secret: "ask",
    write_create: "allow", write_update: "allow", write_delete: "ask",
    execute: "ask", network: "ask", destructive: "deny"
  },
  auto: {
    read: "allow", read_secret: "ask",
    write_create: "allow", write_update: "allow", write_delete: "allow",
    execute: "allow", network: "ask", destructive: "deny"
  },
  "full-auto": {
    read: "allow", read_secret: "ask",
    write_create: "allow", write_update: "allow", write_delete: "allow",
    execute: "allow", network: "allow", destructive: "deny"
  }
});

export function createPermissionEngine() {
  function decide(toolCall, context = {}) {
    const category = toolCall.category || "read";
    const autonomy = context.autonomy || "gated";

    if (category === "destructive") {
      return { decision: "deny", matched_rule: "hardcoded:destructive", source: "safety-invariant" };
    }

    const cached = context.approvalCache?.get?.(fingerprint(toolCall, context));
    if (cached?.decision === "allow") {
      return { decision: "allow", matched_rule: "approval-cache", source: "approval-cache" };
    }

    for (const rule of context.trustStore?.rules || []) {
      if (ruleMatches(rule, toolCall)) {
        return { decision: rule.decision, matched_rule: rule.id, source: "user-trust-store" };
      }
    }

    for (const rule of context.projectRules || []) {
      if (ruleMatches(rule, toolCall)) {
        return { decision: rule.decision, matched_rule: rule.id, source: "project-rules" };
      }
    }

    const matrix = DEFAULT_POLICY_MATRIX[autonomy] || DEFAULT_POLICY_MATRIX.gated;
    return {
      decision: matrix[category] || "ask",
      matched_rule: `default:${autonomy}:${category}`,
      source: "default-matrix"
    };
  }

  function explain(toolCall, context = {}) {
    const result = decide(toolCall, context);
    return {
      ...result,
      reason: `Category: ${toolCall.category} | Autonomy: ${context.autonomy || "gated"} | Source: ${result.source}`
    };
  }

  function fingerprint(toolCall, context = {}) {
    const params = toolCall.params || {};
    const sortedParams = Object.keys(params).sort().reduce((obj, key) => {
      obj[key] = params[key];
      return obj;
    }, {});
    const canonical = JSON.stringify({
      tool: toolCall.name,
      category: toolCall.category,
      params: sortedParams,
      project: context.projectId || ""
    });
    return `fp:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
  }

  return { decide, explain, fingerprint };
}

function ruleMatches(rule, toolCall) {
  if (rule.tool && rule.tool !== toolCall.name) return false;
  if (rule.category && rule.category !== toolCall.category) return false;
  if (rule.pattern) {
    if (!toolCall.params?.path) return false;
    if (!globMatch(rule.pattern, toolCall.params.path)) return false;
  }
  if (rule.match?.argv) {
    const callArgv = toolCall.params?.argv || [];
    if (!arraysEqual(rule.match.argv, callArgv)) return false;
  }
  return true;
}

export function globMatch(pattern, value) {
  let source = pattern
    .replace(/\*\*/g, "\x00DSTAR\x00")
    .replace(/\*/g, "\x00STAR\x00")
    .replace(/\?/g, "\x00QMARK\x00");
  source = source.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  source = source
    .replace(/\x00DSTAR\x00/g, ".*")
    .replace(/\x00STAR\x00/g, "[^/]*")
    .replace(/\x00QMARK\x00/g, "[^/]");
  return new RegExp(`^${source}$`).test(value);
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

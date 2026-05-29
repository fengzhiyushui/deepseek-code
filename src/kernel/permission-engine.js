// src/kernel/permission-engine.js
import { createHash } from "node:crypto";

export const DEFAULT_POLICY_MATRIX = {
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
};

export function createPermissionEngine() {

  function decide(toolCall, context) {
    const category = toolCall.category || "read";
    const autonomy = context.autonomy || "gated";

    // 1. Check user trust store rules (highest priority)
    const userRules = context.trustStore?.rules || [];
    for (const rule of userRules) {
      if (ruleMatches(rule, toolCall, context)) {
        return {
          decision: rule.decision,
          matched_rule: rule.id,
          source: "user-trust-store"
        };
      }
    }

    // 2. Check project-level rules
    const projectRules = context.projectRules || [];
    for (const rule of projectRules) {
      if (ruleMatches(rule, toolCall, context)) {
        return {
          decision: rule.decision,
          matched_rule: rule.id,
          source: "project-rules"
        };
      }
    }

    // 3. Fall back to default policy matrix
    const matrix = DEFAULT_POLICY_MATRIX[autonomy] || DEFAULT_POLICY_MATRIX.gated;
    const decision = matrix[category] || "ask";

    return {
      decision,
      matched_rule: `default:${autonomy}:${category}`,
      source: "default-matrix"
    };
  }

  function explain(toolCall, context) {
    const result = decide(toolCall, context);
    return {
      ...result,
      reason: buildReason(result, toolCall, context)
    };
  }

  function fingerprint(toolCall, context) {
    const parts = {
      tool: toolCall.tool,
      argv: toolCall.params?.argv || [],
      cwd: toolCall.params?.cwd || "",
      resource: toolCall.params?.path || toolCall.params?.pattern || "",
      project: context.projectId || ""
    };
    const canonical = JSON.stringify(parts, Object.keys(parts).sort());
    return `fp:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
  }

  return { decide, explain, fingerprint };
}

// -- helpers --

function ruleMatches(rule, toolCall, context) {
  if (rule.category && rule.category !== toolCall.category) return false;
  if (rule.pattern && toolCall.params?.path) {
    if (!globMatch(rule.pattern, toolCall.params.path)) return false;
  }
  if (rule.match?.argv) {
    const callArgv = toolCall.params?.argv || [];
    if (!arraysEqual(rule.match.argv, callArgv)) return false;
  }
  return true;
}

function globMatch(pattern, value) {
  // Replace glob tokens first, then escape regex special characters
  let escaped = pattern;
  escaped = escaped.replace(/\*\*/g, "___STARSTAR___");
  escaped = escaped.replace(/\*/g, "[^/]*");
  escaped = escaped.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  escaped = escaped.replace(/___STARSTAR___/g, ".*");
  const regex = new RegExp("^" + escaped + "$");
  return regex.test(value);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildReason(result, toolCall, context) {
  const parts = [`Category: ${toolCall.category}`];
  parts.push(`Autonomy: ${context.autonomy}`);
  parts.push(`Decision: ${result.decision}`);
  parts.push(`Source: ${result.source}`);
  if (result.matched_rule) parts.push(`Rule: ${result.matched_rule}`);
  return parts.join(" | ");
}

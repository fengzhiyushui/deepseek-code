// src/kernel/tool-registry.js
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

async function resolvePath(rawPath, projectRoot) {
  if (!rawPath) throw new Error("path is required");
  if (!projectRoot) throw new Error("projectRoot is required for path resolution");
  const resolved = path.resolve(projectRoot, rawPath);
  // Resolve symlinks to get the real filesystem path
  let real;
  try {
    real = await fs.realpath(resolved);
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist yet — walk up to find an existing ancestor
      let searchDir = path.dirname(resolved);
      while (true) {
        try {
          const parentReal = await fs.realpath(searchDir);
          real = path.join(parentReal, path.relative(searchDir, resolved));
          break;
        } catch (e) {
          if (e.code === "ENOENT") {
            const nextDir = path.dirname(searchDir);
            if (nextDir === searchDir) {
              // Reached filesystem root without finding anything — fall back to lexical
              real = resolved;
              break;
            }
            searchDir = nextDir;
            continue;
          }
          throw e;
        }
      }
    } else {
      throw err;
    }
  }
  const rel = path.relative(projectRoot, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${rawPath}`);
  }
  return resolved; // return the original resolved path for use, not the real path
}

export const BUILTIN_TOOLS = [
  { name: "read", description: "Read a file from the project", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { path: { type: "string" } },
    execute: async (params, ctx) => {
      const target = await resolvePath(params.path, ctx.projectRoot);
      const content = await fs.readFile(target, "utf8");
      return { content: [{ type: "text", text: content }] };
    }
  },
  { name: "write", description: "Write or overwrite a file", category: "write_update",
    side_effect: "filesystem", risk_level: "medium", source: "builtin", version: "1.0",
    params: { path: { type: "string" }, content: { type: "string" } },
    execute: async (params, ctx) => {
      const target = await resolvePath(params.path, ctx.projectRoot);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, params.content, "utf8");
      return { content: [{ type: "text", text: `Wrote ${params.path}` }] };
    }
  },
  { name: "grep", description: "Search file contents with regex", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { pattern: { type: "string" }, path: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "no matches" }] })
  },
  { name: "glob", description: "Find files matching a pattern", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { pattern: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "[]" }] })
  },
  { name: "ls", description: "List directory contents", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { path: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "[]" }] })
  },
  { name: "git_read", description: "Git read operations (status, diff, log)", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { op: { type: "string", enum: ["status", "diff", "log", "show", "blame"] } },
    execute: async () => ({ content: [{ type: "text", text: "" }] })
  },
  { name: "edit", description: "Apply a unified diff patch", category: "write_update",
    side_effect: "filesystem", risk_level: "medium", source: "builtin", version: "1.0",
    params: { diff: { type: "string" }, path: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "patch applied" }] })
  },
  { name: "delete", description: "Delete a file or directory", category: "write_delete",
    side_effect: "filesystem", risk_level: "high", source: "builtin", version: "1.0",
    params: { path: { type: "string" } },
    execute: async (params, ctx) => {
      const target = await resolvePath(params.path, ctx.projectRoot);
      await fs.rm(target, { force: true });
      return { content: [{ type: "text", text: `Deleted ${params.path}` }] };
    }
  },
  { name: "shell", description: "Execute a shell command", category: "execute",
    side_effect: "process", risk_level: "medium", source: "builtin", version: "1.0",
    params: { argv: { type: "array" }, cwd: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "command executed" }], stdout: "", stderr: "" })
  },
  { name: "test", description: "Run project test suite", category: "execute",
    side_effect: "process", risk_level: "low", source: "builtin", version: "1.0",
    params: { command: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "tests passed" }], stdout: "" })
  },
  { name: "git_write", description: "Git write operations (commit, branch, tag)", category: "write_update",
    side_effect: "filesystem", risk_level: "high", source: "builtin", version: "1.0",
    params: { op: { type: "string" }, message: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "git operation done" }] })
  },
  { name: "ask_user", description: "Ask the user a question", category: "read",
    side_effect: "none", risk_level: "low", source: "builtin", version: "1.0",
    params: { question: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "user response" }] })
  },
  { name: "web_search", description: "Search the web", category: "network",
    side_effect: "network", risk_level: "medium", source: "builtin", version: "1.0",
    params: { query: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "search results" }] })
  },
  { name: "web_fetch", description: "Fetch a URL", category: "network",
    side_effect: "network", risk_level: "medium", source: "builtin", version: "1.0",
    params: { url: { type: "string" } },
    execute: async () => ({ content: [{ type: "text", text: "fetched content" }] })
  }
];

export function createToolRegistry({ permissionEngine }) {
  const tools = new Map();
  for (const def of BUILTIN_TOOLS) {
    tools.set(def.name, { ...def });
  }

  function register(toolDef) {
    tools.set(toolDef.name, { ...toolDef });
  }

  function resolve(name) {
    return tools.get(name);
  }

  function listTools(filter = {}) {
    let result = [...tools.values()];
    if (filter.category) result = result.filter(t => t.category === filter.category);
    if (filter.source) result = result.filter(t => t.source === filter.source);
    return result;
  }

  function normalizeParams(toolName, rawParams) {
    const def = tools.get(toolName);
    if (!def) throw new Error(`Unknown tool: ${toolName}`);

    if (toolName === "shell") {
      if (typeof rawParams.cmd === "string") {
        throw new Error("Shell cmd string is not supported. Use structured argv: { argv: ['npm', 'test'] }");
      }
      return {
        argv: rawParams.argv || [],
        cwd: rawParams.cwd || ".",
        shell: false
      };
    }

    return rawParams;
  }

  async function execute(toolCall, context) {
    const def = tools.get(toolCall.tool);
    if (!def) {
      return makeResult(toolCall.id, "error", [{ type: "error", text: `Unknown tool: ${toolCall.tool}` }]);
    }

    const normalizedParams = normalizeParams(toolCall.tool, toolCall.params || {});

    const fullCall = {
      id: toolCall.id,
      tool: def.name,
      category: def.category,
      risk_level: def.risk_level,
      side_effect: def.side_effect,
      params: normalizedParams
    };

    const permission = permissionEngine.decide(fullCall, context);
    if (permission.decision === "deny") {
      return makeResult(toolCall.id, "denied", [{ type: "error", text: `Permission denied: ${permission.matched_rule}` }]);
    }
    if (permission.decision === "ask") {
      return {
        id: toolCall.id || `result_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        status: "approval_required",
        content: [{ type: "text", text: `Approval required: ${permission.matched_rule}` }],
        metadata: { matched_rule: permission.matched_rule },
        duration_ms: 0
      };
    }

    const startTime = Date.now();
    try {
      const result = def.execute
        ? await def.execute(normalizedParams, context)
        : { content: [{ type: "text", text: "ok" }] };

      return {
        id: toolCall.id || `result_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        status: "success",
        ...result,
        duration_ms: Date.now() - startTime
      };
    } catch (error) {
      return makeResult(toolCall.id, "error", [{ type: "error", text: error.message }], {},
        Date.now() - startTime);
    }
  }

  return { register, resolve, listTools, normalizeParams, execute };
}

function makeResult(id, status, content, metadata = {}, duration_ms = 0) {
  return {
    id: id || `result_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    status,
    content,
    metadata,
    duration_ms
  };
}

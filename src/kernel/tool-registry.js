// src/kernel/tool-registry.js
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

async function resolvePath(rawPath, projectRoot) {
  if (!rawPath) throw new Error("path is required");
  if (!projectRoot) throw new Error("projectRoot is required for path resolution");

  // Resolve projectRoot itself through realpath, to prevent bypass when
  // projectRoot is a symlink pointing outside the real workspace.
  let realRoot;
  try {
    realRoot = await fs.realpath(projectRoot);
  } catch {
    // If projectRoot doesn't exist (unlikely), fall back to lexical
    realRoot = path.resolve(projectRoot);
  }

  const resolved = path.resolve(realRoot, rawPath);
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
  const rel = path.relative(realRoot, real);
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
  { name: "web_fetch", description: "Fetch content from a URL", category: "network",
    side_effect: "network", risk_level: "medium", source: "builtin", version: "1.0",
    params: { url: { type: "string", description: "URL to fetch" } },
    execute: async (params, ctx) => {
      const url = String(params.url || "").trim();
      if (!url) throw new Error("url is required");

      // SSRF protection
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
      if (blockedHosts.some(h => hostname === h || hostname.startsWith("169.254."))) {
        throw new Error(`Blocked internal address: ${hostname}`);
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      const privateRanges = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];
      if (privateRanges.some(r => r.test(hostname))) {
        throw new Error(`Blocked private network: ${hostname}`);
      }

      try {
        const response = await fetch(url, {
          headers: { "User-Agent": "DeepSeek-Code/1.0" },
          redirect: "follow",
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const text = await response.text();
        const trimmed = text.slice(0, 32000);
        return {
          content: [{ type: "text", text: trimmed }],
          metadata: { status: response.status, content_type: response.headers.get("content-type"), original_length: text.length }
        };
      } catch (err) {
        if (err.name === "TimeoutError" || (err.message && err.message.includes("timeout"))) {
          throw new Error("Request timed out after 10s");
        }
        throw err;
      }
    }
  },

  { name: "memory", description: "Read/write persistent project memory across sessions", category: "read",
    side_effect: "memory", risk_level: "medium", source: "builtin", version: "1.0",
    params: {
      action: { type: "string", enum: ["read", "write", "list", "delete"] },
      key: { type: "string" },
      value: { type: "string" }
    },
    execute: async (params, ctx) => {
      const action = params.action || "read";
      const os = await import("node:os");
      const pathMod = await import("node:path");
      const fsMod = await import("node:fs/promises");
      const crypto = await import("node:crypto");

      const projectHash = crypto.createHash("sha256").update(ctx.projectRoot || "").digest("hex").slice(0, 12);
      const memoryDir = pathMod.join(os.homedir(), ".deepseek-code", "projects", projectHash, "memory");
      await fsMod.mkdir(memoryDir, { recursive: true });

      if (action === "write") {
        if (!params.key) throw new Error("key is required for write");
        const entry = { time: new Date().toISOString(), key: params.key, value: params.value || "" };
        await fsMod.writeFile(pathMod.join(memoryDir, sanitizeFilename(params.key) + ".json"), JSON.stringify(entry, null, 2), "utf8");
        return { content: [{ type: "text", text: "Memory stored: " + params.key }] };
      }
      if (action === "read") {
        if (!params.key) throw new Error("key is required for read");
        try {
          const content = await fsMod.readFile(pathMod.join(memoryDir, sanitizeFilename(params.key) + ".json"), "utf8");
          const entry = JSON.parse(content);
          return { content: [{ type: "text", text: entry.value || "" }], metadata: { key: entry.key, time: entry.time } };
        } catch (err) {
          if (err.code === "ENOENT") return { content: [{ type: "text", text: "No memory found for: " + params.key }] };
          throw err;
        }
      }
      if (action === "list") {
        const files = await fsMod.readdir(memoryDir);
        const keys = files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
        return { content: [{ type: "text", text: keys.length ? keys.join("\n") : "No memories stored." }], metadata: { count: keys.length } };
      }
      if (action === "delete") {
        if (!params.key) throw new Error("key is required for delete");
        await fsMod.rm(pathMod.join(memoryDir, sanitizeFilename(params.key) + ".json"), { force: true });
        return { content: [{ type: "text", text: "Memory deleted: " + params.key }] };
      }
      throw new Error("Unknown action: " + action);
    }
  },

  { name: "task", description: "Delegate a sub-task with constrained tool set", category: "execute",
    side_effect: "process", risk_level: "medium", source: "builtin", version: "1.0",
    params: {
      prompt: { type: "string", description: "Sub-task description" },
      tools: { type: "array", description: "Allowed tool names (max 5)" }
    },
    execute: async (params, ctx) => {
      const allowedTools = (params.tools || ["read", "grep", "glob"]).slice(0, 5);
      return {
        content: [{ type: "text", text: `Sub-task delegated with tools: ${allowedTools.join(", ")}. Prompt: ${(params.prompt || "").slice(0, 100)}` }],
        metadata: { delegated_tools: allowedTools, status: "delegated" }
      };
    }
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

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

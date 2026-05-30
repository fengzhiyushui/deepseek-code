import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createMemoryTool() {
  return {
    name: "memory",
    description: "Read and write project-scoped memory",
    category: "read",
    side_effect: "memory",
    risk_level: "medium",
    source: "builtin",
    version: "2.0",
    params: {
      action: { type: "string", enum: ["read", "write", "list", "delete"] },
      key: { type: "string", required: false },
      value: { type: "string", required: false }
    },
    resolveCategory(params) {
      if (params.action === "write") return "write_update";
      if (params.action === "delete") return "write_delete";
      return "read";
    },
    execute: async (params, context) => {
      const dir = await memoryDir(context);
      const action = params.action || "read";
      if (action === "write") {
        requireKey(params.key, "write");
        await fs.writeFile(entryPath(dir, params.key), JSON.stringify({
          key: params.key,
          value: params.value || "",
          time: new Date().toISOString()
        }), "utf8");
        return { content: [{ type: "text", text: `Memory stored: ${params.key}` }] };
      }
      if (action === "read") {
        requireKey(params.key, "read");
        try {
          const entry = JSON.parse(await fs.readFile(entryPath(dir, params.key), "utf8"));
          return { content: [{ type: "text", text: entry.value || "" }], metadata: { key: entry.key, time: entry.time } };
        } catch (error) {
          if (error.code === "ENOENT") return { content: [{ type: "text", text: `No memory found for: ${params.key}` }] };
          throw error;
        }
      }
      if (action === "list") {
        const files = await fs.readdir(dir);
        const keys = files.filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5));
        return { content: [{ type: "text", text: keys.join("\n") }], metadata: { count: keys.length } };
      }
      if (action === "delete") {
        requireKey(params.key, "delete");
        await fs.rm(entryPath(dir, params.key), { force: true });
        return { content: [{ type: "text", text: `Memory deleted: ${params.key}` }] };
      }
      throw new Error(`unknown memory action: ${action}`);
    }
  };
}

async function memoryDir(context) {
  const base = context.memoryRoot || path.join(os.homedir(), ".deepseek-code");
  const projectHash = createHash("sha256").update(context.projectRoot || "").digest("hex").slice(0, 12);
  const dir = path.join(base, "projects", projectHash, "memory");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function entryPath(dir, key) {
  return path.join(dir, sanitize(key) + ".json");
}

function sanitize(key) {
  return String(key).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

function requireKey(key, action) {
  if (!key) throw new Error(`key is required for ${action}`);
}

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInsideRoot } from "./context.js";
import { parseUnifiedDiff, summarizeDiff } from "./patch.js";

export async function captureChangePlan(root, diff, prompt) {
  const patches = parseUnifiedDiff(diff);
  const files = [];

  for (const patch of patches) {
    const filePath = patch.newPath === "/dev/null" ? patch.oldPath : patch.newPath;
    const beforePath = patch.oldPath === "/dev/null" ? null : patch.oldPath;
    let before = null;
    if (beforePath) {
      before = stripBom(await fs.readFile(resolveInsideRoot(root, beforePath), "utf8"));
    }
    files.push({
      path: filePath,
      oldPath: patch.oldPath,
      newPath: patch.newPath,
      status: patch.oldPath === "/dev/null" ? "create" : patch.newPath === "/dev/null" ? "delete" : "modify",
      before
    });
  }

  return {
    id: makeChangeId(),
    time: new Date().toISOString(),
    prompt,
    diff,
    summary: summarizeDiff(diff),
    files
  };
}

export async function finalizeChange(root, plan) {
  const files = [];
  for (const item of plan.files) {
    const currentPath = item.newPath === "/dev/null" ? item.oldPath : item.newPath;
    let after = null;
    if (item.newPath !== "/dev/null") {
      after = stripBom(await fs.readFile(resolveInsideRoot(root, currentPath), "utf8"));
    }
    files.push({ ...item, after });
  }

  const record = { ...plan, files };
  const target = changePath(root, record.id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function listChanges(root, limit = 20) {
  const dir = changesDir(root);
  try {
    const entries = await fs.readdir(dir);
    const records = [];
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      const target = path.join(dir, entry);
      const record = JSON.parse(await fs.readFile(target, "utf8"));
      records.push(record);
    }
    return records
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, limit);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function describeChange(root, id) {
  return readChange(root, id || "latest");
}

export async function rollbackChange(root, id) {
  const record = await readChange(root, id || "latest");
  for (const file of record.files) {
    const filePath = file.newPath === "/dev/null" ? file.oldPath : file.newPath;
    const target = resolveInsideRoot(root, filePath);
    if (file.status === "create") {
      await fs.rm(target, { force: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.before ?? "", "utf8");
    }
  }

  const rollbackPath = path.join(root, ".deepseek-code", "rollbacks.jsonl");
  await fs.mkdir(path.dirname(rollbackPath), { recursive: true });
  await fs.appendFile(rollbackPath, `${JSON.stringify({ time: new Date().toISOString(), id: record.id })}\n`, "utf8");
  return record;
}

export function formatChange(record) {
  const lines = [
    `变更 ID：${record.id}`,
    `时间：${record.time}`,
    `需求：${record.prompt}`,
    "",
    "文件："
  ];
  for (const item of record.summary) {
    lines.push(`  ${translateStatus(item.status).padEnd(4)} ${item.path}`);
  }
  lines.push("");
  lines.push("补丁：");
  lines.push(record.diff);
  return lines.join("\n");
}

async function readChange(root, id) {
  if (id === "latest") {
    const [latest] = await listChanges(root, 1);
    if (!latest) {
      throw new Error("还没有可回退的变更记录。");
    }
    return latest;
  }
  const target = changePath(root, id);
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`找不到变更记录：${id}`);
    }
    throw error;
  }
}

function changesDir(root) {
  return path.join(root, ".deepseek-code", "changes");
}

function changePath(root, id) {
  return path.join(changesDir(root), `${id}.json`);
}

function makeChangeId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function translateStatus(status) {
  if (status === "create") {
    return "新建";
  }
  if (status === "delete") {
    return "删除";
  }
  return "修改";
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

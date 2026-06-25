import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteJson(filePath, value) {
  await atomicWriteBytes(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicReadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function atomicWriteBytes(filePath, bytes) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(directory, `.recovery-tmp-${process.pid}-${randomUUID()}`);
  await writeFile(tempPath, bytes);
  await rename(tempPath, filePath);
}

const RECOVERY_TEMP_BASENAME_PATTERN = /^\.recovery-tmp-\d+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const RECOVERY_SEGMENT_PATTERN = /^[a-zA-Z0-9._-]{1,120}$/;

export async function cleanupAtomicTemps(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile() || !RECOVERY_TEMP_BASENAME_PATTERN.test(entry.name)) {
      continue;
    }
    await unlink(path.join(directory, entry.name));
    removed.push(entry.name);
  }
  return removed;
}

export function safeRecoverySegment(value) {
  if (typeof value !== "string" || value === "." || value === ".." || !RECOVERY_SEGMENT_PATTERN.test(value)) {
    throw new Error(`invalid recovery path segment: ${value}`);
  }
  return value;
}

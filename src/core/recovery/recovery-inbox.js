import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { atomicReadJson, atomicWriteJson } from "./atomic-file.js";

const SCHEMA_VERSION = 1;
const INBOX_MUTEX_DIR = ".inbox-update-gate";
const INBOX_MUTEX_CLEANUP_DIR = ".inbox-update-gate-cleanup";
const INBOX_MUTEX_METADATA_FILE = "mutex.json";
const INBOX_MUTEX_RETRY_MS = 10;
const INBOX_MUTEX_TIMEOUT_MS = 10_000;
const CROSS_HOST_INBOX_MUTEX_TIMEOUT_MS = 30_000;
const MAX_REQUIRED_STRING_LENGTH = 512;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_ALLOWED_ACTIONS = 20;
const MAX_ALLOWED_ACTION_LENGTH = 80;
const MAX_SUMMARY_PAYLOAD_BYTES = 8_192;
const MAX_SUMMARY_PAYLOAD_DEPTH = 8;
const MAX_SUMMARY_PAYLOAD_KEYS = 80;
const MAX_SUMMARY_PAYLOAD_ARRAY_ITEMS = 80;
const MAX_SUMMARY_PAYLOAD_STRING_LENGTH = 1_000;
const CLEARABLE_STATUSES = new Set(["done", "cancelled", "quarantined"]);
const REQUIRED_STRING_FIELDS = ["id", "type", "status", "source_id"];
const ALLOWED_ITEM_FIELDS = new Set([
  "id",
  "type",
  "status",
  "source_id",
  "summary",
  "evidence",
  "allowed_actions",
  "metadata",
  "created_at",
  "updated_at"
]);
const ALLOWED_MARK_FIELDS = new Set(["status", "evidence", "allowed_actions"]);
const FORBIDDEN_SUMMARY_PAYLOAD_KEYS = new Set([
  "resume_state",
  "resumeState",
  "file_bytes",
  "fileBytes",
  "diff",
  "diffs",
  "prompt",
  "prompts",
  "undo_data",
  "undoData",
  "raw",
  "content",
  "bytes",
  "blob",
  "blobs"
]);

export function createRecoveryInbox({ root }) {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("invalid recovery inbox root");
  }

  const filePath = path.join(root, ".deepseek-code", "v2", "recovery", "inbox.json");
  const recoveryDir = path.dirname(filePath);

  return {
    async list({ includeCleared = false } = {}) {
      const inbox = await readInbox(filePath);
      return sortItems(inbox.items).filter((item) => includeCleared || item.status !== "cleared");
    },

    async get(id) {
      validateId(id);
      const inbox = await readInbox(filePath);
      return inbox.items.find((item) => item.id === id) || null;
    },

    async upsert(item) {
      validateItemInput(item);
      await withInboxUpdateMutex(recoveryDir, async () => {
        const inbox = await readInbox(filePath);
        const now = new Date().toISOString();
        const index = inbox.items.findIndex((candidate) => candidate.id === item.id);

        if (index === -1) {
          inbox.items.push({ ...cloneJson(item), created_at: now, updated_at: now });
        } else {
          const existing = inbox.items[index];
          if (existing.status === "cleared") {
            throw new Error("cannot upsert cleared recovery item");
          }
          inbox.items[index] = {
            ...existing,
            ...cloneJson(item),
            status: existing.status,
            evidence: "evidence" in item ? cloneJson(item.evidence) : cloneJsonOptional(existing.evidence),
            allowed_actions: "allowed_actions" in item ? cloneJson(item.allowed_actions) : cloneJsonOptional(existing.allowed_actions),
            created_at: isFiniteTimestamp(existing.created_at) ? existing.created_at : now,
            updated_at: now
          };
          if (inbox.items[index].evidence === undefined) {
            delete inbox.items[index].evidence;
          }
          if (inbox.items[index].allowed_actions === undefined) {
            delete inbox.items[index].allowed_actions;
          }
        }

        await writeInbox(filePath, inbox);
      });
    },

    async clear(id) {
      validateId(id);
      await withInboxUpdateMutex(recoveryDir, async () => {
        const inbox = await readInbox(filePath);
        const item = findItemOrThrow(inbox, id);
        if (!CLEARABLE_STATUSES.has(item.status)) {
          throw new Error("cannot clear blocked recovery item");
        }

        item.status = "cleared";
        item.updated_at = new Date().toISOString();
        await writeInbox(filePath, inbox);
      });
    },

    async mark(id, patch) {
      validateId(id);
      validateMarkPatch(patch);
      await withInboxUpdateMutex(recoveryDir, async () => {
        const inbox = await readInbox(filePath);
        const item = findItemOrThrow(inbox, id);
        if (item.status === "cleared") {
          throw new Error("cannot mark cleared recovery item");
        }

        for (const [key, value] of Object.entries(patch)) {
          item[key] = cloneJson(value);
        }
        validatePersistedItem(item);
        item.updated_at = new Date().toISOString();
        await writeInbox(filePath, inbox);
      });
    }
  };
}

async function readInbox(filePath) {
  try {
    const inbox = await atomicReadJson(filePath);
    return normalizeInbox(inbox);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { schema_version: SCHEMA_VERSION, items: [] };
    }
    throw error;
  }
}

async function writeInbox(filePath, inbox) {
  await atomicWriteJson(filePath, normalizeInbox(inbox));
}

function normalizeInbox(inbox) {
  if (!inbox || typeof inbox !== "object" || Array.isArray(inbox)) {
    throw new Error("invalid recovery inbox schema");
  }
  if (inbox.schema_version !== SCHEMA_VERSION) {
    throw new Error("invalid recovery inbox schema version");
  }
  if (!Array.isArray(inbox.items)) {
    throw new Error("invalid recovery inbox items");
  }
  for (const item of inbox.items) {
    validatePersistedItem(item, { requireTimestamps: true });
  }
  return { schema_version: SCHEMA_VERSION, items: inbox.items.map((item) => cloneJson(item)) };
}

function validateItemInput(item) {
  validatePlainObject(item, "invalid recovery inbox item");
  for (const key of Object.keys(item)) {
    if (!ALLOWED_ITEM_FIELDS.has(key)) {
      throw new Error(`disallowed recovery inbox payload field: ${key}`);
    }
  }
  validatePersistedItem(item);
}

function validatePersistedItem(item, { requireTimestamps = false } = {}) {
  validatePlainObject(item, "invalid recovery inbox item");
  for (const key of Object.keys(item)) {
    if (!ALLOWED_ITEM_FIELDS.has(key)) {
      throw new Error(`invalid recovery inbox item field: ${key}`);
    }
  }
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!validString(item[field])) {
      throw new Error(`invalid recovery inbox item ${field}`);
    }
  }
  if (!validSummary(item.summary)) {
    throw new Error("invalid recovery inbox item summary");
  }
  if ("evidence" in item) {
    validateSummaryPayload(item.evidence, "evidence");
  }
  if ("allowed_actions" in item && !isStringArray(item.allowed_actions)) {
    throw new Error("invalid recovery inbox item allowed_actions");
  }
  if (requireTimestamps && !("created_at" in item)) {
    throw new Error("invalid recovery inbox item created_at");
  }
  if ("created_at" in item && !isFiniteTimestamp(item.created_at)) {
    throw new Error("invalid recovery inbox item created_at");
  }
  if (requireTimestamps && !("updated_at" in item)) {
    throw new Error("invalid recovery inbox item updated_at");
  }
  if ("updated_at" in item && !isFiniteTimestamp(item.updated_at)) {
    throw new Error("invalid recovery inbox item updated_at");
  }
}

function validateMarkPatch(patch) {
  validatePlainObject(patch, "invalid recovery inbox mark patch");
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_MARK_FIELDS.has(key)) {
      throw new Error(`disallowed recovery inbox mark field: ${key}`);
    }
  }
  if ("status" in patch && !validString(patch.status)) {
    throw new Error("invalid recovery inbox item status");
  }
  if (patch.status === "cleared") {
    throw new Error("cannot mark recovery inbox item cleared; use clear()");
  }
  if ("evidence" in patch) {
    validateSummaryPayload(patch.evidence, "evidence");
  }
  if ("allowed_actions" in patch && !isStringArray(patch.allowed_actions)) {
    throw new Error("invalid recovery inbox item allowed_actions");
  }
}

function validateSummaryPayload(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid recovery inbox item ${name}`);
  }
  const stats = { keys: 0 };
  validateSummaryPayloadValue(value, name, 0, stats);
  const encoded = JSON.stringify(value);
  if (encoded.length > MAX_SUMMARY_PAYLOAD_BYTES) {
    throw new Error(`invalid recovery inbox item ${name}: payload too large`);
  }
}

function validateSummaryPayloadValue(value, pathName, depth, stats) {
  if (depth > MAX_SUMMARY_PAYLOAD_DEPTH) {
    throw new Error(`invalid recovery inbox item ${pathName}: payload too deep`);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SUMMARY_PAYLOAD_ARRAY_ITEMS) {
      throw new Error(`invalid recovery inbox item ${pathName}: array too large`);
    }
    for (const [index, item] of value.entries()) {
      validateSummaryPayloadValue(item, `${pathName}[${index}]`, depth + 1, stats);
    }
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    stats.keys += entries.length;
    if (stats.keys > MAX_SUMMARY_PAYLOAD_KEYS) {
      throw new Error(`invalid recovery inbox item ${pathName}: too many fields`);
    }
    for (const [key, child] of entries) {
      if (FORBIDDEN_SUMMARY_PAYLOAD_KEYS.has(key)) {
        throw new Error(`disallowed recovery inbox summary payload field: ${pathName}.${key}`);
      }
      validateSummaryPayloadValue(child, `${pathName}.${key}`, depth + 1, stats);
    }
    return;
  }
  if (typeof value === "string" && value.length > MAX_SUMMARY_PAYLOAD_STRING_LENGTH) {
    throw new Error(`invalid recovery inbox item ${pathName}: string too large`);
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new Error(`invalid recovery inbox item ${pathName}: non-json value`);
  }
}

function validatePlainObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function validateId(id) {
  if (!validString(id)) {
    throw new Error("invalid recovery inbox item id");
  }
}

function findItemOrThrow(inbox, id) {
  const item = inbox.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error("recovery inbox item not found");
  }
  return item;
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const byCreatedAt = Date.parse(left.created_at) - Date.parse(right.created_at);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

function validString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REQUIRED_STRING_LENGTH;
}

function validSummary(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SUMMARY_LENGTH;
}

function isStringArray(value) {
  return Array.isArray(value) &&
    value.length <= MAX_ALLOWED_ACTIONS &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= MAX_ALLOWED_ACTION_LENGTH);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneJsonOptional(value) {
  return value === undefined ? undefined : cloneJson(value);
}

function isFiniteTimestamp(value) {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

async function withInboxUpdateMutex(recoveryDir, operation) {
  await mkdir(recoveryDir, { recursive: true });
  const gatePath = path.join(recoveryDir, INBOX_MUTEX_DIR);
  const cleanupGatePath = path.join(recoveryDir, INBOX_MUTEX_CLEANUP_DIR);
  const startedAt = Date.now();
  const holderToken = randomUUID();
  let acquired = false;

  while (!acquired) {
    await waitForInboxCleanupGate(cleanupGatePath, startedAt);
    try {
      await mkdir(gatePath, { recursive: false });
      try {
        await writeInboxMutexMetadata(gatePath, {
          token: holderToken,
          pid: process.pid,
          host: hostname(),
          created_at: new Date().toISOString()
        });
      } catch (error) {
        await removeInboxMutex(gatePath);
        throw error;
      }
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleInboxMutex(gatePath, cleanupGatePath, startedAt)) {
        continue;
      }
      if (Date.now() - startedAt >= INBOX_MUTEX_TIMEOUT_MS) {
        throw new Error("timed out waiting for recovery inbox update lock");
      }
      await delay(INBOX_MUTEX_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await removeInboxMutexIfHeld(gatePath, holderToken);
  }
}

async function waitForInboxCleanupGate(cleanupGatePath, startedAt) {
  while (await pathExists(cleanupGatePath)) {
    if (await removeStaleInboxCleanupGate(cleanupGatePath)) {
      continue;
    }
    if (Date.now() - startedAt >= INBOX_MUTEX_TIMEOUT_MS) {
      throw new Error("timed out waiting for recovery inbox cleanup lock");
    }
    await delay(INBOX_MUTEX_RETRY_MS);
  }
}

async function writeInboxMutexMetadata(mutexPath, metadata) {
  await writeFile(path.join(mutexPath, INBOX_MUTEX_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function readInboxMutexMetadata(mutexPath) {
  try {
    const metadata = JSON.parse(await readFile(path.join(mutexPath, INBOX_MUTEX_METADATA_FILE), "utf8"));
    if (!isValidInboxMutexMetadata(metadata)) {
      return { ok: false, metadata: null };
    }
    return { ok: true, metadata };
  } catch {
    return { ok: false, metadata: null };
  }
}

function isValidInboxMutexMetadata(metadata) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      validString(metadata.token) &&
      Number.isInteger(metadata.pid) &&
      metadata.pid > 0 &&
      validString(metadata.host) &&
      isFiniteTimestamp(metadata.created_at)
  );
}

async function removeStaleInboxMutex(gatePath, cleanupGatePath, startedAt) {
  const firstRead = await readInboxMutexMetadata(gatePath);
  if (!(await isInboxMutexStale(gatePath, firstRead))) {
    return false;
  }

  const cleanupToken = await acquireInboxCleanupGate(cleanupGatePath, startedAt);
  if (cleanupToken === null) {
    return false;
  }

  try {
    const secondRead = await readInboxMutexMetadata(gatePath);
    if (!sameInboxMutexRead(firstRead, secondRead)) {
      return false;
    }
    if (!(await isInboxMutexStale(gatePath, secondRead))) {
      return false;
    }
    await removeInboxMutex(gatePath);
    return true;
  } finally {
    await removeInboxMutexIfHeld(cleanupGatePath, cleanupToken);
  }
}

async function acquireInboxCleanupGate(cleanupGatePath, startedAt) {
  const holderToken = randomUUID();
  while (true) {
    try {
      await mkdir(cleanupGatePath, { recursive: false });
      try {
        await writeInboxMutexMetadata(cleanupGatePath, {
          token: holderToken,
          pid: process.pid,
          host: hostname(),
          created_at: new Date().toISOString()
        });
      } catch (error) {
        await removeInboxMutex(cleanupGatePath);
        throw error;
      }
      return holderToken;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleInboxCleanupGate(cleanupGatePath)) {
        continue;
      }
      if (Date.now() - startedAt >= INBOX_MUTEX_TIMEOUT_MS) {
        throw new Error("timed out waiting for recovery inbox cleanup lock");
      }
      await delay(INBOX_MUTEX_RETRY_MS);
    }
  }
}

async function removeStaleInboxCleanupGate(cleanupGatePath) {
  const metadataRead = await readInboxMutexMetadata(cleanupGatePath);
  if (!(await isInboxMutexStale(cleanupGatePath, metadataRead))) {
    return false;
  }
  if (metadataRead.ok) {
    await removeInboxMutexIfHeld(cleanupGatePath, metadataRead.metadata.token);
    return true;
  }
  await removeInboxMutex(cleanupGatePath);
  return true;
}

async function isInboxMutexStale(mutexPath, metadataRead) {
  if (metadataRead.ok) {
    if (metadataRead.metadata.host === hostname() && isPidLive(metadataRead.metadata.pid)) {
      return false;
    }
    const age = Date.now() - Date.parse(metadataRead.metadata.created_at);
    const timeout = metadataRead.metadata.host === hostname() ? INBOX_MUTEX_TIMEOUT_MS : CROSS_HOST_INBOX_MUTEX_TIMEOUT_MS;
    return !Number.isFinite(age) || Math.max(0, age) >= timeout;
  }

  try {
    const stats = await stat(mutexPath);
    const age = Date.now() - stats.mtimeMs;
    return !Number.isFinite(age) || Math.max(0, age) >= INBOX_MUTEX_TIMEOUT_MS;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function sameInboxMutexRead(left, right) {
  if (left.ok || right.ok) {
    return left.ok === right.ok && left.metadata?.token === right.metadata?.token;
  }
  return true;
}

async function removeInboxMutexIfHeld(mutexPath, holderToken) {
  const metadataRead = await readInboxMutexMetadata(mutexPath);
  if (!metadataRead.ok || metadataRead.metadata.token !== holderToken) {
    return;
  }
  await removeInboxMutex(mutexPath);
}

async function removeInboxMutex(mutexPath) {
  await rm(mutexPath, { recursive: true, force: true });
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isPidLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH" && error?.code !== "EINVAL";
  }
}

// src/kernel/session-log.js
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;

const RESERVED_KEYS = new Set([
  "schema_version", "event_id", "prev_hash", "event_hash",
  "type", "timestamp", "seq", "session_id"
]);

function stripReservedKeys(data) {
  if (!data || typeof data !== "object") return {};
  const cleaned = {};
  for (const key of Object.keys(data)) {
    if (!RESERVED_KEYS.has(key)) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

export async function createSessionLog(baseDir, projectId, sessionId, meta) {
  const dir = sessionDir(baseDir, projectId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionFilePath(dir, sessionId);

  const log = new SessionLogWriter(filePath, sessionId);

  const safeMeta = stripReservedKeys(meta);
  const startEvent = {
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(),
    prev_hash: null,
    event_hash: null,
    type: "session:start",
    timestamp: new Date().toISOString(),
    seq: 1,
    session_id: sessionId,
    ...safeMeta
  };
  startEvent.event_hash = hashEvent(startEvent);

  await appendLine(filePath, startEvent);
  log.lastHash = startEvent.event_hash;
  log.seq = 1;

  return log;
}

export async function openSessionLog(baseDir, projectId, sessionId) {
  const dir = sessionDir(baseDir, projectId);
  const filePath = sessionFilePath(dir, sessionId);

  const existing = await readAllLines(filePath);
  const lastEvent = existing.length > 0 ? existing[existing.length - 1] : null;

  // Validate hash chain integrity
  if (!validateHashChain(existing)) {
    console.error(`SessionLog: hash chain validation failed for ${sessionId}. Some events may be corrupted.`);
  }

  const log = new SessionLogWriter(filePath, sessionId);
  log.lastHash = lastEvent?.event_hash ?? null;
  log.seq = lastEvent?.seq ?? 0;

  return log;
}

// New helper: validate hash chain
function validateHashChain(events) {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Recompute hash and verify stored event_hash matches
    const computedHash = hashEvent(event);
    if (computedHash !== event.event_hash) {
      return false;
    }

    // Verify prev_hash chain (skip first event)
    if (i > 0) {
      const expectedPrev = events[i - 1].event_hash;
      if (event.prev_hash !== expectedPrev) {
        return false;
      }
    }
  }
  return true;
}

class SessionLogWriter {
  constructor(filePath, sessionId) {
    this.filePath = filePath;
    this.sessionId = sessionId;
    this.lastHash = null;
    this.seq = 0;
    this._appendQueue = Promise.resolve();  // serialization queue
  }

  async append(eventType, data) {
    // Serialize all append calls through a chain of promises
    const prev = this._appendQueue;
    let resolveQueue;
    this._appendQueue = new Promise((r) => { resolveQueue = r; });

    await prev;

    try {
      this.seq += 1;
      // Strip reserved keys from caller data to prevent field overwriting
      const safeData = stripReservedKeys(data);

      const event = {
        schema_version: SCHEMA_VERSION,
        event_id: makeEventId(),
        prev_hash: this.lastHash,
        event_hash: null,
        type: eventType,
        timestamp: new Date().toISOString(),
        seq: this.seq,
        ...safeData
      };
      event.event_hash = hashEvent(event);

      await appendLine(this.filePath, event);
      this.lastHash = event.event_hash;

      return event;
    } finally {
      resolveQueue();
    }
  }

  async tail(count) {
    const all = await readAllLines(this.filePath);
    return all.slice(-count);
  }
}

// -- internal helpers --

function sessionDir(baseDir, projectId) {
  return path.join(baseDir, "sessions", sanitize(projectId));
}

function sessionFilePath(dir, sessionId) {
  return path.join(dir, `${sanitize(sessionId)}.jsonl`);
}

async function appendLine(filePath, event) {
  await fs.appendFile(filePath, JSON.stringify(event) + "\n", "utf8");
}

async function readAllLines(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const events = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        // Skip corrupt lines so one bad entry does not block
        // access to all other events.
      }
    }
    return events;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function hashEvent(event) {
  const { event_hash, ...rest } = event;
  const safe = jsonSafe(rest);
  const canonical = stableStringify(safe);
  return `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

// Strip undefined values to match JSON.stringify's serialization behavior.
// JSON.stringify drops keys with undefined values, so our hash must too.
function jsonSafe(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined) {
      result[key] = jsonSafe(value[key]);
    }
  }
  return result;
}

function stableStringify(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${parts.join(",")}}`;
}

function makeEventId() {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

// src/kernel/session-log.js
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;

export async function createSessionLog(baseDir, projectId, sessionId, meta) {
  const dir = sessionDir(baseDir, projectId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = sessionFilePath(dir, sessionId);

  const log = new SessionLogWriter(filePath, sessionId);

  const startEvent = {
    schema_version: SCHEMA_VERSION,
    event_id: makeEventId(),
    prev_hash: null,
    event_hash: null,
    type: "session:start",
    timestamp: new Date().toISOString(),
    seq: 1,
    session_id: sessionId,
    ...meta
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

  // Read existing events to recover last_hash and seq
  const existing = await readAllLines(filePath);
  const lastEvent = existing.length > 0 ? existing[existing.length - 1] : null;

  const log = new SessionLogWriter(filePath, sessionId);
  log.lastHash = lastEvent?.event_hash ?? null;
  log.seq = lastEvent?.seq ?? 0;

  return log;
}

class SessionLogWriter {
  constructor(filePath, sessionId) {
    this.filePath = filePath;
    this.sessionId = sessionId;
    this.lastHash = null;
    this.seq = 0;
  }

  async append(eventType, data) {
    this.seq += 1;
    const event = {
      schema_version: SCHEMA_VERSION,
      event_id: makeEventId(),
      prev_hash: this.lastHash,
      event_hash: null,
      type: eventType,
      timestamp: new Date().toISOString(),
      seq: this.seq,
      ...data
    };
    event.event_hash = hashEvent(event);

    await appendLine(this.filePath, event);
    this.lastHash = event.event_hash;

    return event;
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
    return content
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function hashEvent(event) {
  const { event_hash, ...rest } = event;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

function makeEventId() {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
}

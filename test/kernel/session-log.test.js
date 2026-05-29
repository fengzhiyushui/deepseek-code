// test/kernel/session-log.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSessionLog, openSessionLog } from "../../src/kernel/session-log.js";

const tmpDir = path.join(os.tmpdir(), `dsc-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("creates a new session log with session:start event", async () => {
  const log = await createSessionLog(tmpDir, "test-project", "sess_001", {
    mode: "cli",
    cwd: "/fake/project",
    git_commit: "abc1234",
    config_id: "cfg_v1"
  });
  assert.ok(log.sessionId === "sess_001");

  const events = await log.tail(10);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "session:start");
  assert.equal(events[0].schema_version, 1);
  assert.ok(events[0].event_id.startsWith("evt_"));
  assert.ok(typeof events[0].event_hash === "string");
  assert.equal(events[0].prev_hash, null); // first event has no prev
});

test("appends events with hash chain", async () => {
  const log = await createSessionLog(tmpDir, "test-project", "sess_002", {
    mode: "cli",
    cwd: "/fake"
  });

  await log.append("user:message", { content: "hello" });
  await log.append("model:response", { content: "hi" });

  const events = await log.tail(5);
  assert.equal(events.length, 3); // session:start + 2 new

  // hash chain: each event has prev_hash pointing to previous event_hash
  assert.equal(events[1].prev_hash, events[0].event_hash);
  assert.equal(events[2].prev_hash, events[1].event_hash);
});

test("tail respects count limit", async () => {
  const log = await createSessionLog(tmpDir, "test-project", "sess_003", {
    mode: "cli", cwd: "/fake"
  });

  for (let i = 0; i < 10; i++) {
    await log.append("user:message", { content: `msg ${i}` });
  }

  const tail = await log.tail(5);
  assert.equal(tail.length, 5);
});

test("reopens existing session log and appends", async () => {
  const log1 = await createSessionLog(tmpDir, "test-project", "sess_004", {
    mode: "cli", cwd: "/fake"
  });
  await log1.append("user:message", { content: "first" });

  // Reopen
  const log2 = await openSessionLog(tmpDir, "test-project", "sess_004");
  await log2.append("user:message", { content: "second" });

  const events = await log2.tail(10);
  const types = events.map((e) => e.type);
  // session:start, user:message, user:message
  assert.equal(events.length, 3);
  assert.deepEqual(types, ["session:start", "user:message", "user:message"]);
});

test("events carry the defined schema_version", async () => {
  const log = await createSessionLog(tmpDir, "test-project", "sess_005", {
    mode: "cli", cwd: "/fake"
  });
  await log.append("tool:call", { tool: "read", params: { path: "a.js" } });

  const events = await log.tail(5);
  for (const evt of events) {
    assert.equal(evt.schema_version, 1);
  }
});

test("session:start includes metadata fields", async () => {
  const meta = {
    mode: "tui",
    cwd: "/home/user/project",
    git_commit: "def5678",
    config_id: "cfg_prod"
  };
  const log = await createSessionLog(tmpDir, "test-project", "sess_006", meta);

  const events = await log.tail(1);
  const start = events[0];
  assert.equal(start.mode, "tui");
  assert.equal(start.cwd, "/home/user/project");
  assert.equal(start.git_commit, "def5678");
  assert.equal(start.config_id, "cfg_prod");
  assert.ok(typeof start.session_id === "string");
});

test("recovers readable events from a partially corrupted log", async () => {
  // Manually write a JSONL file with a corrupt line in the middle
  const dir = path.join(tmpDir, "sessions", "test-project");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "sess_corrupt.jsonl");

  const good1 = JSON.stringify({ schema_version: 1, event_id: "evt_aaa", prev_hash: null, event_hash: "sha256:aaa", type: "session:start", timestamp: new Date().toISOString(), seq: 1, session_id: "sess_corrupt" });
  const corrupt = "{ this is not valid json }";
  const good2 = JSON.stringify({ schema_version: 1, event_id: "evt_bbb", prev_hash: "sha256:aaa", event_hash: "sha256:bbb", type: "user:message", timestamp: new Date().toISOString(), seq: 2 });

  await fs.writeFile(filePath, `${good1}\n${corrupt}\n${good2}\n`, "utf8");

  const log = await openSessionLog(tmpDir, "test-project", "sess_corrupt");
  const events = await log.tail(10);

  // Should recover the 2 valid events (corrupt line skipped)
  assert.equal(events.length, 2);
  assert.equal(events[0].event_id, "evt_aaa");
  assert.equal(events[1].event_id, "evt_bbb");
});

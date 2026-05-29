// test/kernel/session-manager.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createEventBus } from "../../src/kernel/event-bus.js";
import { createSessionLog } from "../../src/kernel/session-log.js";
import { createSessionManager } from "../../src/kernel/session-manager.js";

const tmpDir = path.join(os.tmpdir(), `dsc-sm-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("bridge persists EventBus events to SessionLog", async () => {
  const bus = createEventBus();
  const log = await createSessionLog(tmpDir, "test-project", "sess_sm_001", {
    mode: "cli", cwd: "/fake", git_commit: "abc", config_id: "cfg"
  });

  const manager = createSessionManager({ eventBus: bus, sessionLog: log });
  const sub = manager.bridge(["orchestrator:state", "user:message", "tool:call"]);

  bus.publish("orchestrator:state", {
    state: { entered: "thinkplan", exited: "classify" },
    transition: { reason: "test", autonomy: { level: "gated" }, channel: "think" },
    trace: { id: "trace_001", timestamp: new Date().toISOString() }
  });
  bus.publish("user:message", { content: "hello" });

  await sub.flush();

  const events = await log.tail(10);
  assert.ok(events.length >= 2);
  const types = events.map(e => e.type);
  assert.ok(types.includes("orchestrator:state"));
  assert.ok(types.includes("user:message"));
});

test("bridge ignores unsubscribed event types", async () => {
  const bus = createEventBus();
  const log = await createSessionLog(tmpDir, "test-project", "sess_sm_002", {
    mode: "cli", cwd: "/fake", git_commit: "abc", config_id: "cfg"
  });

  const manager = createSessionManager({ eventBus: bus, sessionLog: log });
  const sub = manager.bridge(["user:message"]);

  bus.publish("orchestrator:state", {
    state: { entered: "classify", exited: "idle" },
    transition: { reason: "test", autonomy: { level: "gated" }, channel: null },
    trace: { id: "trace_x", timestamp: new Date().toISOString() }
  });
  bus.publish("user:message", { content: "bridged" });

  await sub.flush();

  const events = await log.tail(10);
  const types = events.map(e => e.type);
  assert.ok(!types.includes("orchestrator:state"));
  assert.ok(types.includes("user:message"));
});

test("getTimeline returns events from log", async () => {
  const bus = createEventBus();
  const log = await createSessionLog(tmpDir, "test-project", "sess_sm_003", {
    mode: "cli", cwd: "/fake", git_commit: "abc", config_id: "cfg"
  });

  const manager = createSessionManager({ eventBus: bus, sessionLog: log });
  const sub = manager.bridge(["user:message"]);

  bus.publish("user:message", { content: "msg1" });
  bus.publish("user:message", { content: "msg2" });
  bus.publish("user:message", { content: "msg3" });

  await sub.flush();

  const timeline = await manager.getTimeline(2);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].content, "msg2");
  assert.equal(timeline[1].content, "msg3");
});

test("getTimeline returns empty for no session", async () => {
  const bus = createEventBus();
  const manager = createSessionManager({ eventBus: bus, sessionLog: null });
  const timeline = await manager.getTimeline(10);
  assert.deepEqual(timeline, []);
});

test("shutdown stops bridging", async () => {
  const bus = createEventBus();
  const log = await createSessionLog(tmpDir, "test-project", "sess_sm_004", {
    mode: "cli", cwd: "/fake", git_commit: "abc", config_id: "cfg"
  });

  const manager = createSessionManager({ eventBus: bus, sessionLog: log });
  const sub = manager.bridge(["user:message"]);

  bus.publish("user:message", { content: "before" });
  await sub.flush();

  sub.unsubscribe();

  bus.publish("user:message", { content: "after" });
  await new Promise(r => setTimeout(r, 20));

  const events = await log.tail(10);
  const contents = events.filter(e => e.type === "user:message").map(e => e.content);
  assert.ok(contents.includes("before"));
  assert.ok(!contents.includes("after"));
});

// -- Integration tests: kernel-api + session manager --

import { createKernel } from "../../src/kernel/kernel-api.js";

const kernelTmpDir = path.join(os.tmpdir(), `dsc-kernel-test-${Date.now()}`);

test("agent.send publishes user:message on EventBus", async () => {
  await fs.mkdir(kernelTmpDir, { recursive: true });
  await fs.writeFile(path.join(kernelTmpDir, "package.json"), "{}", "utf8");

  const kernel = await createKernel(kernelTmpDir, { config: { allowMissingKey: true } });
  const received = [];
  kernel.eventBus.subscribe("user:message", (data) => received.push(data));

  // Fire and forget: orchestrator may hang waiting for approval, but the
  // event is published synchronously before submit is called.
  kernel.agent.send("hello world").catch(() => {});
  // Let microtasks flush so subscriber fires
  await new Promise(r => setTimeout(r, 50));

  assert.ok(received.length >= 1, "agent.send should publish user:message");
  assert.equal(received[0].content, "hello world");

  // Clean up the hung orchestrator
  kernel.agent.interrupt();

  await fs.rm(kernelTmpDir, { recursive: true, force: true });
});

test("session.subscribe receives orchestrator state events", async () => {
  await fs.mkdir(kernelTmpDir, { recursive: true });
  await fs.writeFile(path.join(kernelTmpDir, "package.json"), "{}", "utf8");

  const kernel = await createKernel(kernelTmpDir, { config: { allowMissingKey: true } });
  const events = [];
  kernel.session.subscribe((evt) => events.push(evt));

  // Fire and forget: the orchestrator transitions through states
  // (CLASSIFY -> AWAITAPPROVAL) which publish "orchestrator:state" events.
  kernel.agent.send("explain the project").catch(() => {});
  await new Promise(r => setTimeout(r, 50));

  // Should have received at least some orchestrator state events
  const stateEvents = events.filter(e => e.type === "orchestrator:state");
  assert.ok(stateEvents.length >= 1, "session.subscribe should receive orchestrator:state events");

  // Clean up
  kernel.agent.interrupt();

  await fs.rm(kernelTmpDir, { recursive: true, force: true });
});

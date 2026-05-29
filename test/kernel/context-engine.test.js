// test/kernel/context-engine.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createContextEngine } from "../../src/kernel/context-engine.js";

const tmpDir = path.join(os.tmpdir(), `dsc-ctx-test-${Date.now()}`);

test.before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "README.md"), "# Test Project\nHello.", "utf8");
  await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf8");
  await fs.writeFile(path.join(tmpDir, "src", "index.js"), "const x = 1;\nfunction main() {}\n", "utf8");
  await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules\n", "utf8");
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("creates ContextUnits from files", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const stats = engine.getCacheStats();
  assert.ok(stats.total_units >= 2);
});

test("ContextUnit has required fields", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const unit = engine.getUnit("README.md");
  assert.ok(unit);
  assert.equal(unit.type, "file");
  assert.equal(unit.source, "README.md");
  assert.ok(typeof unit.token_count === "number");
  assert.ok(unit.token_count > 0);
  assert.ok(typeof unit.hash === "string");
  assert.ok(unit.hash.startsWith("sha256:"));
  assert.ok(typeof unit.freshness === "string");
  assert.ok(unit.priority >= 0 && unit.priority <= 4);
});

test("getUnit returns undefined for unknown file", () => {
  const engine = createContextEngine(tmpDir);
  assert.equal(engine.getUnit("nonexistent.js"), undefined);
});

test("pin promotes unit to P4", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  engine.pin("README.md");
  const unit = engine.getUnit("README.md");
  assert.equal(unit.priority, 4);
});

test("unpin demotes unit from P4", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  engine.pin("README.md");
  engine.unpin("README.md");
  const unit = engine.getUnit("README.md");
  assert.ok(unit.priority < 4);
});

test("warm loads a cold file into warm layer", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  engine.warm("src/index.js");
  const snapshot = engine.snapshot("think", "think");
  const unit = engine.getUnit("src/index.js");
  assert.ok(snapshot.units.includes(unit.id));
});

test("snapshot for think channel includes P0-P2 by default", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const snapshot = engine.snapshot("plan", "think");
  assert.ok(typeof snapshot.snapshot_id === "string");
  assert.ok(snapshot.snapshot_id.startsWith("snap_"));
  assert.equal(snapshot.channel, "think");
  assert.ok(Array.isArray(snapshot.units));
  assert.ok(Array.isArray(snapshot.unit_hashes));
  assert.ok(snapshot.budget.allocated > 0);
  assert.ok(snapshot.budget.used >= 0);
  assert.ok(typeof snapshot.expected_cache_prefix_offset === "number");
});

test("snapshot for act channel has smaller budget", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const thinkSnap = engine.snapshot("plan", "think");
  const actSnap = engine.snapshot("execute", "act");
  assert.ok(actSnap.budget.allocated <= thinkSnap.budget.allocated);
});

test("snapshot is reproducible with same inputs", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const snap1 = engine.snapshot("plan", "think");
  const snap2 = engine.snapshot("plan", "think");
  assert.notEqual(snap1.snapshot_id, snap2.snapshot_id);
  assert.deepEqual(snap1.unit_hashes.sort(), snap2.unit_hashes.sort());
});

test("cache stats show correct layer distribution", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const stats = engine.getCacheStats();
  assert.ok(stats.total_units > 0);
  assert.ok(stats.hot_units >= 0);
  assert.ok(stats.warm_units >= 0);
});

test("setChannelConfig overrides budget", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  engine.setChannelConfig("think", { maxBudget: 100000 });
  const snapshot = engine.snapshot("analyze", "think");
  assert.equal(snapshot.budget.allocated, 100000);
});

test("invalidation: file change updates hash", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const before = engine.getUnit("README.md");
  const beforeHash = before.hash;
  await fs.writeFile(path.join(tmpDir, "README.md"), "# Updated\nChanged.", "utf8");
  engine.invalidate("README.md");
  // invalidate is async — wait a tick
  await new Promise(r => setTimeout(r, 100));
  const after = engine.getUnit("README.md");
  assert.notEqual(after.hash, beforeHash);
  assert.ok(new Date(after.freshness).getTime() >= new Date(before.freshness).getTime());
});

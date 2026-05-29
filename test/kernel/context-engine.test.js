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

test("unknown source files default to P3 cold tier", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const unit = engine.getUnit("src/index.js");
  assert.equal(unit.priority, 3);
});

test("warming promotes a P3 file into warm set", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();

  // src/index.js should be P3 (cold) by default
  const unit = engine.getUnit("src/index.js");
  assert.equal(unit.priority, 3);

  // warm() moves it into warm set without changing priority
  engine.warm("src/index.js");
  const stats = engine.getCacheStats();
  assert.ok(stats.warm_units >= 1);

  // It should appear in snapshot (warm set bypasses priority filter)
  const snapshot = engine.snapshot("plan", "think");
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
  await engine.invalidate("README.md");  // await the returned promise
  const after = engine.getUnit("README.md");
  assert.notEqual(after.hash, beforeHash);
  assert.ok(new Date(after.freshness).getTime() >= new Date(before.freshness).getTime());
});

test("prune removes units for deleted files", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const before = engine.getCacheStats().total_units;
  // Create then delete a temp file
  await fs.writeFile(path.join(tmpDir, "temp-delete.js"), "// will be deleted", "utf8");
  await engine.scan();
  assert.ok(engine.getUnit("temp-delete.js"));
  await fs.rm(path.join(tmpDir, "temp-delete.js"));
  const removed = await engine.prune();
  assert.ok(removed >= 1);
  assert.equal(engine.getUnit("temp-delete.js"), undefined);
});

test("readTextFile rejects path traversal attempts", async () => {
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  const beforeStats = engine.getCacheStats();

  // Attempt to invalidate with a path that traverses outside the project root.
  // The internal path guard in readTextFile should throw, and invalidate's
  // catch handler should suppress it — no crash, state preserved.
  await engine.invalidate("../etc/passwd");
  await engine.invalidate("../../windows/system32/config");
  // Also try a sibling-directory bypass (the startsWith bug on Windows)
  await engine.invalidate("../dsc-ctx-test-bypass/secret.txt");

  // Engine should still be in a valid, consistent state
  const afterStats = engine.getCacheStats();
  assert.equal(afterStats.total_units, beforeStats.total_units,
    "No units should be added from outside the project root");

  const snap = engine.snapshot("test", "think");
  assert.ok(Array.isArray(snap.units));
  // All unit IDs should still be valid (prefixed with "unit_")
  for (const uid of snap.units) {
    assert.ok(uid.startsWith("unit_"), `Unexpected unit ID: ${uid}`);
  }
  // Snapshot budget should be non-negative
  assert.ok(snap.budget.used >= 0);
  assert.ok(snap.expected_cache_prefix_offset >= 0);
});

test("scan discovers extensionless text files like Makefile and Dockerfile", async () => {
  await fs.writeFile(path.join(tmpDir, "Makefile"), "all:\n\techo hello\n", "utf8");
  await fs.writeFile(path.join(tmpDir, "Dockerfile"), "FROM node:20\n", "utf8");
  await fs.writeFile(path.join(tmpDir, "LICENSE"), "MIT\n", "utf8");
  const engine = createContextEngine(tmpDir);
  await engine.scan();
  assert.ok(engine.getUnit("Makefile"));
  assert.ok(engine.getUnit("Dockerfile"));
  assert.ok(engine.getUnit("LICENSE"));
});

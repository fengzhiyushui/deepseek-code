import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hashContent,
  restoreSnapshots,
  snapshotTouchedFiles
} from "../../../src/edits/edit-transaction.js";
import { parseDiff } from "../../../src/edits/diff-parser.js";

test("hashContent returns stable sha256 metadata", () => {
  const result = hashContent("hello\n");

  assert.equal(result.hash.startsWith("sha256:"), true);
  assert.equal(result.bytes, Buffer.byteLength("hello\n"));
  assert.equal(hashContent("hello\n").hash, result.hash);
  assert.notEqual(hashContent("other\n").hash, result.hash);
});

test("snapshotTouchedFiles records existing and created file states", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-tx-snapshot-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/new.txt b/new.txt",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1 @@",
    "+created"
  ].join("\n");
  const parsed = parseDiff(diff);

  const snapshots = await snapshotTouchedFiles(root, parsed.patches);

  const byPath = Object.fromEntries(snapshots.map((item) => [item.path, item]));
  assert.equal(byPath["a.txt"].status, "modify");
  assert.equal(byPath["a.txt"].existed_before, true);
  assert.equal(byPath["a.txt"].before, "old\n");
  assert.equal(byPath["a.txt"].before_hash, hashContent("old\n").hash);
  assert.equal(byPath["new.txt"].status, "create");
  assert.equal(byPath["new.txt"].existed_before, false);
  assert.equal(byPath["new.txt"].before, null);
  assert.equal(byPath["new.txt"].before_hash, null);
});

test("restoreSnapshots restores modified files and removes created files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-tx-restore-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const parsed = parseDiff([
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/new.txt b/new.txt",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1 @@",
    "+created"
  ].join("\n"));
  const snapshots = await snapshotTouchedFiles(root, parsed.patches);
  await writeFile(path.join(root, "a.txt"), "new\n");
  await writeFile(path.join(root, "new.txt"), "created\n");

  const restored = await restoreSnapshots(root, snapshots);

  assert.deepEqual(restored.sort(), ["a.txt", "new.txt"]);
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "old\n");
  await assert.rejects(() => readFile(path.join(root, "new.txt"), "utf8"), /ENOENT/);
});

test("snapshotTouchedFiles refuses create patches when target already exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-tx-create-exists-"));
  await writeFile(path.join(root, "new.txt"), "user content\n");
  const parsed = parseDiff([
    "diff --git a/new.txt b/new.txt",
    "--- /dev/null",
    "+++ b/new.txt",
    "@@ -0,0 +1 @@",
    "+created"
  ].join("\n"));

  await assert.rejects(
    () => snapshotTouchedFiles(root, parsed.patches),
    /already exists/
  );
});

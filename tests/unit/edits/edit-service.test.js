import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createEditService } from "../../../src/edits/edit-service.js";

const MODIFY_DIFF = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new";

test("preview parses validates and does not write files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const service = createEditService({ projectRoot: root });

  const result = await service.preview({ diff: MODIFY_DIFF });

  assert.equal(result.status, "success");
  assert.match(result.content[0].text, /modify a\.txt/);
  assert.equal(result.metadata.summary[0].path, "a.txt");
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "old\n");
});

test("apply writes files finalizes change and publishes event without raw diff", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const eventBus = createEventBus();
  const events = [];
  eventBus.subscribe("file:diff_applied", (data) => events.push(data));
  const service = createEditService({ projectRoot: root, eventBus });

  const result = await service.apply({ diff: MODIFY_DIFF, prompt: "update a", approval_id: "appr_1" });

  assert.equal(result.status, "success");
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "new\n");
  assert.match(result.metadata.change_id, /^\d{14}$/);
  assert.equal(result.metadata.approval_id, "appr_1");
  assert.equal(events.length, 1);
  assert.equal(events[0].change_id, result.metadata.change_id);
  assert.equal(events[0].diff, undefined);
});

test("rollback restores change and publishes rollback event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const eventBus = createEventBus();
  const rollbacks = [];
  eventBus.subscribe("file:rollback_applied", (data) => rollbacks.push(data));
  const service = createEditService({ projectRoot: root, eventBus });

  const applied = await service.apply({ diff: MODIFY_DIFF, prompt: "update a" });
  const rolledBack = await service.rollback({ change_id: applied.metadata.change_id });

  assert.equal(rolledBack.status, "success");
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "old\n");
  assert.equal(rollbacks.length, 1);
  assert.equal(rollbacks[0].change_id, applied.metadata.change_id);
});

test("apply restores earlier writes when a later patch fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-tx-fail-"));
  await writeFile(path.join(root, "a.txt"), "old a\n");
  await writeFile(path.join(root, "b.txt"), "old b\n");
  const service = createEditService({ projectRoot: root });
  const diff = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-old a",
    "+new a",
    "diff --git a/b.txt b/b.txt",
    "--- a/b.txt",
    "+++ b/b.txt",
    "@@ -1 +1 @@",
    "-not the current content",
    "+new b"
  ].join("\n");

  await assert.rejects(() => service.apply({ diff, prompt: "partial failure" }), /上下文不匹配|context|mismatch/i);

  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "old a\n");
  assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "old b\n");
});

test("apply records before and after hashes in change metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-hashes-"));
  await writeFile(path.join(root, "a.txt"), "old\n");
  const service = createEditService({ projectRoot: root });

  const applied = await service.apply({ diff: MODIFY_DIFF, prompt: "hashes" });
  const record = JSON.parse(await readFile(path.join(root, ".deepseek-code", "changes", `${applied.metadata.change_id}.json`), "utf8"));
  assert.equal(record.files[0].before_hash?.startsWith("sha256:"), true);
  assert.equal(record.files[0].after_hash?.startsWith("sha256:"), true);
  assert.notEqual(record.files[0].before_hash, record.files[0].after_hash);
  assert.equal(record.transaction_id?.startsWith("tx_"), true);
});

test("apply rejects unsafe diff before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-"));
  const service = createEditService({ projectRoot: root });
  const diff = "--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-old\n+new";

  await assert.rejects(() => service.apply({ diff, prompt: "escape" }), /escapes project root/);
});

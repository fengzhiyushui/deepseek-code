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

test("apply rejects unsafe diff before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-edit-service-"));
  const service = createEditService({ projectRoot: root });
  const diff = "--- a/../outside.txt\n+++ b/../outside.txt\n@@ -1 +1 @@\n-old\n+new";

  await assert.rejects(() => service.apply({ diff, prompt: "escape" }), /escapes project root/);
});

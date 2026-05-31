import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKernel } from "../../src/index.js";
import { createToolCall } from "../../src/core/protocol/index.js";

const DIFF_A = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old a\n+new a";
const DIFF_B = "diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old b\n+new b";

test("kernel rewind preview and apply create child branch and rollback later edits", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-v2-rewind-"));
  await writeFile(path.join(root, "a.txt"), "old a\n");
  await writeFile(path.join(root, "b.txt"), "old b\n");
  const kernel = await createKernel(root, {
    sessionRoot: path.join(root, ".sessions"),
    sessionId: "sess_rewind",
    context: { disabled: true }
  });

  kernel.eventBus.publish("user:message", { turn_id: "turn_1", content: "edit a" });
  await kernel.tools.execute(
    createToolCall({ name: "edit", params: { diff: DIFF_A, prompt: "edit a" }, requestedByStepId: "step_1" }),
    { autonomy: "gated", turnId: "turn_1" }
  );
  kernel.eventBus.publish("agent:final", { turn_id: "turn_1", content: "done a" });
  kernel.eventBus.publish("user:message", { turn_id: "turn_2", content: "edit b" });
  await kernel.tools.execute(
    createToolCall({ name: "edit", params: { diff: DIFF_B, prompt: "edit b" }, requestedByStepId: "step_2" }),
    { autonomy: "gated", turnId: "turn_2" }
  );
  kernel.eventBus.publish("agent:final", { turn_id: "turn_2", content: "done b" });
  await kernel.session.flush();

  const preview = await kernel.session.rewind.preview({ target: { turn_id: "turn_1" } });
  assert.equal(preview.rollback_count, 1);

  const result = await kernel.session.rewind.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "success");
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "new a\n");
  assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "old b\n");
  assert.notEqual((await kernel.session.branches.getActive()).branch_id, "br_main");
});

test("kernel rewind conflict leaves active branch unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-v2-rewind-conflict-"));
  await writeFile(path.join(root, "a.txt"), "old a\n");
  await writeFile(path.join(root, "b.txt"), "old b\n");
  const kernel = await createKernel(root, {
    sessionRoot: path.join(root, ".sessions"),
    sessionId: "sess_rewind_conflict",
    context: { disabled: true }
  });

  kernel.eventBus.publish("user:message", { turn_id: "turn_1", content: "edit a" });
  await kernel.tools.execute(
    createToolCall({ name: "edit", params: { diff: DIFF_A, prompt: "edit a" }, requestedByStepId: "step_1" }),
    { autonomy: "gated", turnId: "turn_1" }
  );
  kernel.eventBus.publish("agent:final", { turn_id: "turn_1", content: "done a" });
  kernel.eventBus.publish("user:message", { turn_id: "turn_2", content: "edit b" });
  await kernel.tools.execute(
    createToolCall({ name: "edit", params: { diff: DIFF_B, prompt: "edit b" }, requestedByStepId: "step_2" }),
    { autonomy: "gated", turnId: "turn_2" }
  );
  // Manually dirty b.txt to trigger rollback conflict
  await writeFile(path.join(root, "b.txt"), "manual b\n");
  kernel.eventBus.publish("agent:final", { turn_id: "turn_2", content: "done b" });
  await kernel.session.flush();

  const result = await kernel.session.rewind.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "conflict");
  assert.equal((await kernel.session.branches.getActive()).branch_id, "br_main");
  assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "manual b\n");
});

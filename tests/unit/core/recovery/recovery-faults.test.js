import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryFaults } from "../../../../src/core/recovery/recovery-faults.js";

test("recovery faults are no-op by default", async () => {
  const faults = createRecoveryFaults();
  await faults.maybe("after-journal-write");
  assert.equal(faults.hitCount("after-journal-write"), 0);
});

test("recovery faults throw once for configured labels", async () => {
  const faults = createRecoveryFaults({ labels: ["after-journal-write"] });

  await assert.rejects(() => faults.maybe("after-journal-write"), /recovery fault: after-journal-write/);
  await faults.maybe("after-journal-write");
  assert.equal(faults.hitCount("after-journal-write"), 1);
});

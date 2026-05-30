import test from "node:test";
import assert from "node:assert/strict";
import { createApprovalCache } from "../../../src/tools/permissions/approval-cache.js";

test("approval cache grants and expires decisions by fingerprint", () => {
  let now = 1000;
  const cache = createApprovalCache({ now: () => now });

  cache.grant("fp:abc", { decision: "allow", ttlMs: 500 });
  assert.equal(cache.get("fp:abc").decision, "allow");

  now = 1600;
  assert.equal(cache.get("fp:abc"), null);
});

test("approval cache rejects non-allow grants", () => {
  const cache = createApprovalCache();
  assert.throws(() => cache.grant("fp:abc", { decision: "deny", ttlMs: 1000 }), /only stores allow/);
});

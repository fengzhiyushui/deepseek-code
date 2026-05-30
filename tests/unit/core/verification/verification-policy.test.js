import test from "node:test";
import assert from "node:assert/strict";
import { createVerificationPolicy } from "../../../../src/core/verification/verification-policy.js";

test("verification policy auto detects in supervised mode", () => {
  const policy = createVerificationPolicy({ verifyMode: "auto" });
  assert.deepEqual(
    policy.plan({ autonomy: "supervised", hasEditResults: true }),
    { shouldVerify: true, testParams: { detect: true }, mode: "detect" }
  );
});

test("verification policy auto runs tests in gated mode", () => {
  const policy = createVerificationPolicy({ verifyMode: "auto" });
  assert.deepEqual(
    policy.plan({ autonomy: "gated", hasEditResults: true }),
    { shouldVerify: true, testParams: { detect: false }, mode: "run" }
  );
});

test("verification policy accepts explicit argv only as string array", () => {
  const policy = createVerificationPolicy({ verifyMode: "run", testArgv: ["npm", "test"] });
  assert.deepEqual(
    policy.plan({ autonomy: "auto", hasEditResults: true }),
    { shouldVerify: true, testParams: { detect: false, argv: ["npm", "test"] }, mode: "run" }
  );

  assert.throws(
    () => createVerificationPolicy({ verifyMode: "run", testArgv: "npm test" }),
    /testArgv must be an array of strings/
  );
  assert.throws(
    () => createVerificationPolicy({ verifyMode: "run", testArgv: ["npm", 1] }),
    /testArgv must be an array of strings/
  );
});

test("verification policy off or no edit results skips", () => {
  assert.deepEqual(
    createVerificationPolicy({ verifyMode: "off" }).plan({ autonomy: "auto", hasEditResults: true }),
    { shouldVerify: false, reason: "verification disabled", mode: "off" }
  );
  assert.deepEqual(
    createVerificationPolicy({ verifyMode: "run" }).plan({ autonomy: "auto", hasEditResults: false }),
    { shouldVerify: false, reason: "no edit results", mode: "skip" }
  );
});

test("verification policy rejects unknown modes", () => {
  assert.throws(
    () => createVerificationPolicy({ verifyMode: "always" }),
    /unknown verifyMode: always/
  );
});

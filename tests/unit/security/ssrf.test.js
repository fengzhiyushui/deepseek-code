import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFetchUrl,
  validateResolvedAddress,
  isPrivateIPv4
} from "../../../src/security/ssrf.js";
import { redactSecrets } from "../../../src/security/redactor.js";

test("validateFetchUrl allows public https URLs", async () => {
  const result = await validateFetchUrl("https://example.com/docs", {
    lookup: async () => ({ address: "93.184.216.34" })
  });
  assert.equal(result.href, "https://example.com/docs");
});

test("validateFetchUrl blocks localhost private and file URLs", async () => {
  await assert.rejects(() => validateFetchUrl("http://localhost:3000"), /blocked/i);
  await assert.rejects(() => validateFetchUrl("http://127.0.0.2"), /blocked/i);
  await assert.rejects(() => validateFetchUrl("file:///etc/passwd"), /unsupported protocol/i);
  await assert.rejects(() => validateFetchUrl("http://192.168.1.10"), /blocked/i);
});

test("validateFetchUrl blocks DNS rebinding to private IP", async () => {
  await assert.rejects(
    () => validateFetchUrl("https://safe.test", {
      lookup: async () => ({ address: "10.0.0.5" })
    }),
    /blocked private network/
  );
});

test("validateResolvedAddress blocks IPv4 mapped IPv6 and IPv6 literals", () => {
  assert.throws(() => validateResolvedAddress("::ffff:127.0.0.1", "mapped"), /internal/);
  assert.throws(() => validateResolvedAddress("::1", "loopback"), /IPv6/);
});

test("isPrivateIPv4 checks exact private ranges", () => {
  assert.equal(isPrivateIPv4("10.2.3.4"), true);
  assert.equal(isPrivateIPv4("172.16.0.1"), true);
  assert.equal(isPrivateIPv4("172.32.0.1"), false);
  assert.equal(isPrivateIPv4("192.168.1.1"), true);
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
});

test("redactSecrets redacts common secret forms", () => {
  const text = redactSecrets("Authorization: Bearer sk-secret\napi_key=abc123456789");
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.match(text, /api_key=\[REDACTED\]/);
});

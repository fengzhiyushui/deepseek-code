import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFetchUrl,
  validateResolvedAddress,
  isPrivateIPv4,
  isReservedIPv4
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

test("validateFetchUrl validates every DNS A record and fails if any is internal", async () => {
  let optionsSeen = null;
  await assert.rejects(
    () => validateFetchUrl("https://multi.test", {
      lookup: async (_host, options) => {
        optionsSeen = options;
        return [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
      }
    }),
    /blocked private network/
  );
  assert.deepEqual(optionsSeen, { family: 4, all: true });
});

test("validateResolvedAddress blocks reserved IPv4 ranges", () => {
  for (const ip of [
    "0.1.2.3", "100.64.0.1", "100.127.255.254", "192.0.0.8",
    "192.0.2.1", "198.18.0.1", "198.19.255.254", "198.51.100.3",
    "203.0.113.8", "224.0.0.1", "255.255.255.255"
  ]) {
    assert.throws(() => validateResolvedAddress(ip), /blocked reserved network/, ip);
    assert.equal(isReservedIPv4(ip), true, ip);
  }
  assert.equal(isReservedIPv4("93.184.216.34"), false);
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

test("redactSecrets redacts common secret assignment forms", () => {
  const text = redactSecrets([
    "Authorization: Bearer bearer-secret",
    "api_key=abc123456789",
    "access_token: token-value",
    "client_secret='client-value'",
    "password=correct-horse-battery-staple"
  ].join("\n"));
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.match(text, /api_key=\[REDACTED\]/);
  assert.match(text, /access_token: \[REDACTED\]/);
  assert.match(text, /client_secret=\[REDACTED\]/);
  assert.match(text, /password=\[REDACTED\]/);
  assert.doesNotMatch(text, /bearer-secret|abc123456789|token-value|client-value|correct-horse/);
});

test("redactSecrets redacts object JSON while preserving valid JSON", () => {
  const redacted = redactSecrets({ apiKey: "sk-object-secret", nested: { access_token: "token-object" }, safe: "ok" });
  const parsed = JSON.parse(redacted);
  assert.equal(parsed.apiKey, "[REDACTED]");
  assert.equal(parsed.nested.access_token, "[REDACTED]");
  assert.equal(parsed.safe, "ok");
});

test("redactSecrets redacts deterministic AWS GitHub and sk token prefixes", () => {
  const text = redactSecrets([
    "AKIAIOSFODNN7EXAMPLE",
    "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "github_pat_0123456789abcdefghijklmnopqrstuvwxyz",
    "sk-abcdefghijklmnop"
  ].join(" "));
  assert.equal((text.match(/\[REDACTED\]/g) || []).length, 4);
});

test("redactSecrets redacts multiline private key blocks and keeps type", () => {
  const text = redactSecrets("before\n-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----\nafter");
  assert.match(text, /BEGIN RSA PRIVATE KEY/);
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /abc|def/);
  assert.match(text, /after/);
});

test("redactSecrets handles undefined and circular values without throwing", () => {
  assert.equal(redactSecrets(undefined), "undefined");
  const circular = {}; circular.self = circular;
  assert.equal(redactSecrets(circular), "[object Object]");
});

test("redactSecrets does not redact ordinary hashes or short source literals", () => {
  const hash = "9f86d081884c7d659a2feaa0c55ad015";
  assert.equal(redactSecrets(`sha256=${hash} const token = \"short\";`), `sha256=${hash} const token = \"short\";`);
});

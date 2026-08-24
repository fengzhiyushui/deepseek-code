import test from "node:test";
import assert from "node:assert/strict";
import {
  describeSensitiveNotice,
  createSensitiveNoticeHandler,
  SENSITIVE_NOTICE_SEVERITY
} from "../../../src/apps/sensitive-notice-contract.js";

test("describeSensitiveNotice normalizes payload into a display descriptor", () => {
  const d = describeSensitiveNotice({
    paths: [{ path: ".env", reason: "secret-file" }, { path: ".npmrc", reason: "credential-file" }],
    recordDir: ".deepseek-code/changes"
  });
  assert.equal(d.kind, "sensitive-file-write");
  assert.equal(d.severity, SENSITIVE_NOTICE_SEVERITY);
  assert.equal(d.severity, "danger");
  assert.equal(d.count, 2);
  assert.deepEqual(d.paths, [
    { path: ".env", reason: "secret-file", reasonKey: "sensitive.reason.secret" },
    { path: ".npmrc", reason: "credential-file", reasonKey: "sensitive.reason.credential" }
  ]);
});

test("describeSensitiveNotice is total: never throws on junk input", () => {
  assert.equal(describeSensitiveNotice(null), null);
  assert.equal(describeSensitiveNotice({}), null);
  assert.equal(describeSensitiveNotice({ paths: [] }), null);
  const d = describeSensitiveNotice({ paths: [{}] });
  assert.equal(d.paths[0].path, "");
  assert.equal(d.paths[0].reasonKey, "sensitive.reason.other");
  assert.equal(d.recordDir, ".deepseek-code/changes");
});

test("handler allows only on explicit true and never caches the answer", async () => {
  const asked = [];
  const handler = createSensitiveNoticeHandler(async (d) => { asked.push(d); return true; });
  const notice = { paths: [{ path: ".env", reason: "secret-file" }] };

  assert.equal(await handler(notice), true);
  assert.equal(await handler(notice), true);
  // 同一份载荷问两次就得提问两次 —— 不缓存是本设计的硬要求
  assert.equal(asked.length, 2, "选择不得被缓存,每次都要提问");
});

test("handler declines on anything other than true, and reports it", async () => {
  const declined = [];
  const notice = { paths: [{ path: ".env", reason: "secret-file" }] };

  for (const answer of [false, undefined, null, "yes", 1]) {
    const handler = createSensitiveNoticeHandler(async () => answer, (d) => declined.push(d));
    assert.equal(await handler(notice), false, `${String(answer)} 不得被当作同意`);
  }
  assert.equal(declined.length, 5);
});

// 策略回归:没有任何自治档位能跳过提问 —— handler 从结构上就拿不到 autonomy,
// ask 只收到展示描述符。这条测试锁住这个设计选择,防止后人加「按档位放行」。
test("handler takes no autonomy input, so no autonomy level can skip the prompt", async () => {
  const calls = [];
  const handler = createSensitiveNoticeHandler(async (...args) => { calls.push(args); return true; });
  await handler({ paths: [{ path: ".env", reason: "secret-file" }], autonomy: "full-auto" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1, "ask 只接收展示描述符一个参数");
  const descriptor = calls[0][0];
  assert.equal(descriptor.autonomy, undefined, "描述符不得携带 autonomy");
  assert.deepEqual(
    Object.keys(descriptor).sort(),
    ["count", "kind", "paths", "recordDir", "severity"],
    "描述符字段集固定,不含任何档位信息"
  );
});

test("createSensitiveNoticeHandler requires an ask function", () => {
  assert.throws(() => createSensitiveNoticeHandler(null), /ask is required/);
});

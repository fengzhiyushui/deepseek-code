import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekGateway } from "../../../src/deepseek/model-gateway.js";

// 一个永不解决、但响应 abort 的假 fetch
function hangingFetch() {
  return (url, init = {}) => new Promise((_resolve, reject) => {
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) return reject(abortError());
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }
  });
}
function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

test("invoke rejects with MODEL_TIMEOUT after timeoutMs", async () => {
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: hangingFetch() });
  await assert.rejects(
    () => gateway.invoke([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    (e) => e.code === "MODEL_TIMEOUT"
  );
});

test("invoke without timeoutMs is unaffected (resolves normally)", async () => {
  const okFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { total_tokens: 3 } })
  });
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: okFetch });
  const r = await gateway.invoke([{ role: "user", content: "hi" }], {});
  assert.equal(r.content, "ok");
});

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
  e.code = "ABORT_ERR";
  return e;
}

// 响应头立即可得、但 body 永不产生数据、且响应 signal abort 的假流式响应
function hangingStreamFetch() {
  return async (_url, init = {}) => {
    const signal = init.signal;
    const body = {
      getReader() {
        return {
          read() {
            return new Promise((_resolve, reject) => {
              if (!signal) return;
              if (signal.aborted) return reject(abortError());
              signal.addEventListener("abort", () => reject(abortError()), { once: true });
            });
          },
          cancel() { return Promise.resolve(); }
        };
      }
    };
    return { ok: true, status: 200, text: async () => "", body };
  };
}

// 响应头可立即得到、但 body 永不完成的假 JSON 响应
function hangingBodyFetch() {
  return async (_url, init = {}) => {
    const signal = init.signal;
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json() {
        return new Promise((_resolve, reject) => {
          if (!signal) return;
          if (signal.aborted) return reject(abortError());
          signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }
    };
  };
}

test("invoke rejects with MODEL_TIMEOUT after timeoutMs", async () => {
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: hangingFetch() });
  await assert.rejects(
    () => gateway.invoke([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    (e) => e.code === "MODEL_TIMEOUT"
  );
});

test("invoke rejects with MODEL_TIMEOUT when the response body parse hangs past timeoutMs", async () => {
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: hangingBodyFetch() });
  await assert.rejects(
    () => gateway.invoke([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    (e) => e.code === "MODEL_TIMEOUT"
  );
});

test("stream rejects with MODEL_TIMEOUT when the SSE body read hangs past timeoutMs", async () => {
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: hangingStreamFetch() });
  await assert.rejects(
    () => gateway.stream([{ role: "user", content: "hi" }], { timeoutMs: 20 }),
    (e) => e.code === "MODEL_TIMEOUT"
  );
});

test("stream propagates caller abort (ABORT_ERR) during the SSE body read", async () => {
  const controller = new AbortController();
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: hangingStreamFetch() });
  const pending = gateway.stream([{ role: "user", content: "hi" }], { signal: controller.signal, timeoutMs: 10000 });
  const assertion = assert.rejects(pending, (e) => e.code === "ABORT_ERR");
  setTimeout(() => controller.abort(), 5);
  await assertion;
});

test("stream resolves normally when the stream completes before timeoutMs", async () => {
  const streamFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null,\"index\":0}],\"usage\":null}\n\n")); controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); controller.close(); } })
  });
  const gateway = createDeepSeekGateway({ apiKey: "k", fetchImpl: streamFetch });
  const result = await gateway.stream([{ role: "user", content: "hi" }], { timeoutMs: 500 });
  assert.equal(result.content, "ok");
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

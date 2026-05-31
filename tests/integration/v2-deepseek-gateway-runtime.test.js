import test from "node:test";
import assert from "node:assert/strict";
import { createKernel } from "../../src/index.js";

test("createKernel creates DeepSeek gateway from options.deepseek", async () => {
  const calls = [];
  const kernel = await createKernel(process.cwd(), {
    sessionId: "sess_ds",
    sessionLog: null,
    context: { disabled: true },
    deepseek: {
      apiKey: "key",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              finish_reason: "stop",
              message: { role: "assistant", content: "real gateway response" }
            }],
            usage: {
              prompt_tokens: 4,
              completion_tokens: 3,
              prompt_cache_hit_tokens: 1,
              prompt_cache_miss_tokens: 3
            }
          }),
          text: async () => ""
        };
      }
    }
  });

  const result = await kernel.agent.send("hello");
  assert.equal(result.content, "real gateway response");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(kernel.config.getPublicConfig().has_api_key, true);
});

test("runtime passes AbortSignal to model gateway and aborts on interrupt", async () => {
  let seenSignal = null;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });

  const kernel = await createKernel(process.cwd(), {
    sessionId: "sess_ab",
    sessionLog: null,
    context: { disabled: true },
    modelGateway: {
      reply: async ({ signal }) => {
        seenSignal = signal;
        await blocked;
        if (signal.aborted) {
          const err = new Error("aborted by test");
          err.name = "AbortError";
          throw err;
        }
        return { content: "late" };
      }
    }
  });

  const pending = kernel.agent.send("long request");
  await new Promise((resolve) => setTimeout(resolve, 20));
  kernel.agent.interrupt();
  release();

  await assert.rejects(() => pending, /turn was interrupted|aborted by test/);
  assert.equal(seenSignal.aborted, true);
});

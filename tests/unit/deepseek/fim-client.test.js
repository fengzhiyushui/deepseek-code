import test from "node:test";
import assert from "node:assert/strict";
import { buildFimRequest, createFimClient } from "../../../src/deepseek/fim-client.js";
import { normalizeToolCalls, parseToolArguments } from "../../../src/deepseek/tool-call-repair.js";

test("buildFimRequest creates beta completion body without chat-only fields", () => {
  const body = buildFimRequest({ prefix: "function add(a, b) {", suffix: "}", model: "deepseek-v4-flash", maxTokens: 256 });
  assert.deepEqual(body, { model: "deepseek-v4-flash", prompt: "function add(a, b) {", suffix: "}", max_tokens: 256 });
  assert.equal(body.thinking, undefined);
  assert.equal(body.response_format, undefined);
});

test("fim client posts to beta completions endpoint and returns text", async () => {
  const calls = [];
  const client = createFimClient({ apiKey: "key", baseUrl: "https://api.deepseek.com", fetchImpl: async (url, init) => { calls.push({ url, init }); return jsonResponse(200, { choices: [{ text: " return a + b; " }], usage: { prompt_tokens: 10, completion_tokens: 4 } }); } });
  const result = await client.complete({ prefix: "function add(a, b) {", suffix: "}" });
  assert.equal(result.content, " return a + b; ");
  assert.equal(calls[0].url, "https://api.deepseek.com/beta/completions");
  assert.equal(JSON.parse(calls[0].init.body).prompt, "function add(a, b) {");
});

test("normalizeToolCalls preserves raw argument strings and parsed arguments", () => {
  const calls = normalizeToolCalls([{ id: "call_1", type: "function", function: { name: "read", arguments: "{\"path\":\"README.md\"}" } }]);
  assert.equal(calls[0].name, "read");
  assert.deepEqual(calls[0].arguments, { path: "README.md" });
  assert.equal(calls[0].raw_arguments, "{\"path\":\"README.md\"}");
});

test("parseToolArguments marks invalid JSON without throwing", () => {
  const parsed = parseToolArguments("{bad");
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /position 1/);
});

function jsonResponse(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) }; }

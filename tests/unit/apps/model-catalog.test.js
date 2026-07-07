import test from "node:test";
import assert from "node:assert/strict";
import { fetchModelIds } from "../../../src/apps/model-catalog.js";

test("fetches /models with bearer auth and maps ids", async () => {
  const calls = [];
  const ids = await fetchModelIds({
    baseUrl: "https://api.example.com/",
    apiKey: "sk-x",
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => ({ data: [{ id: "m1" }, { id: "m2" }, {}] }) };
    }
  });
  assert.deepEqual(ids, ["m1", "m2"]);
  assert.equal(calls[0].url, "https://api.example.com/models");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-x");
});

test("throws without api key", async () => {
  await assert.rejects(() => fetchModelIds({ baseUrl: "x", apiKey: "" }), /no API key/);
});

test("throws on non-2xx with status detail", async () => {
  await assert.rejects(
    () => fetchModelIds({ baseUrl: "b", apiKey: "k", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "denied" }) }),
    /401 denied/
  );
});

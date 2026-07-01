import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createKernelHost } = require("../../../gui/kernel-host.js");

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), "dsc-set-")); }

test("listModels returns ids on ok, throws on error, no default", async () => {
  const host = createKernelHost({ projectRoot: await tmp() });
  const ok = async () => ({ ok: true, json: async () => ({ data: [{ id: "m1" }, { id: "m2" }] }) });
  assert.deepEqual(await host.listModels(null, { fetchImpl: ok, baseUrl: "https://x", apiKey: "k" }), ["m1", "m2"]);
  const bad = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  await assert.rejects(() => host.listModels(null, { fetchImpl: bad, baseUrl: "https://x", apiKey: "k" }));
  await assert.rejects(() => host.listModels(null, { fetchImpl: ok, baseUrl: "https://x", apiKey: "" })); // no key → throw, no default
});

test("api profiles CRUD + activate writes config; getSettings masks keys", async () => {
  const root = await tmp();
  const host = createKernelHost({ projectRoot: root });
  const p = await host.saveApiProfile({ name: "d", baseUrl: "https://api.deepseek.com", apiKey: "sk-secret-123456", model: "m1" });
  await host.activateApiProfile(p.id);

  const s = await host.getSettings();
  const prof = s.apiProfiles[0];
  assert.equal(prof.hasKey, true);
  assert.equal(prof.name, "d");
  assert.equal(s.activeProfileId, p.id);
  assert.ok(!JSON.stringify(s).includes("sk-secret-123456")); // never plaintext to renderer

  // activate wrote credentials to config.json (so kernel reads them)
  const cfg = JSON.parse(await fs.readFile(path.join(root, ".deepseek-code", "config.json"), "utf8"));
  assert.equal(cfg.apiKey, "sk-secret-123456");

  await host.deleteApiProfile(p.id);
  assert.equal((await host.listApiProfiles()).length, 0);
});

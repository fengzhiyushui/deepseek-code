import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Gated: the Vite renderer build needs gui deps installed (network). Without them
// this skips, so the core suite stays green in a no-deps environment (spec §11).
const guiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "gui");
const viteInstalled = existsSync(path.join(guiDir, "node_modules", "vite"));

test("gui renderer build config + entry are wired", { skip: !viteInstalled ? "gui deps not installed" : false }, async () => {
  // When deps are present, a prior `npm run build:renderer` should have produced the entry.
  const builtIndex = path.join(guiDir, "renderer-dist", "index.html");
  assert.ok(existsSync(path.join(guiDir, "vite.renderer.config.mjs")), "vite config present");
  assert.ok(existsSync(builtIndex), "run `npm run build:renderer` in gui/ to produce renderer-dist/index.html");
});

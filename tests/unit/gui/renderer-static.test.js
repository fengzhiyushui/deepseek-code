import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("renderer workbench html exposes required panels and controls", async () => {
  const html = await readFile("gui/renderer/index.html", "utf8");

  for (const id of [
    "branch-list",
    "checkpoint-list",
    "rewind-preview",
    "rewind-apply",
    "rewind-force",
    "activity-log",
    "messages",
    "msg-input",
    "status-branch",
    "metric-tokens",
    "metric-cache",
    "metric-latency",
    "metric-requests"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} missing`);
  }
});

test("renderer files avoid unsafe html injection and garbled legacy labels", async () => {
  const html = await readFile("gui/renderer/index.html", "utf8");
  const app = await readFile("gui/renderer/app.js", "utf8");

  assert.equal(/\.[\s\n]*innerHTML\s*=/.test(app), false, "no innerHTML assignment");
  assert.equal(html.includes("馃"), false);
  assert.equal(html.includes("鉁"), false);
  assert.equal(html.includes("杈"), false);
  assert.equal(html.includes("鍙"), false);
});

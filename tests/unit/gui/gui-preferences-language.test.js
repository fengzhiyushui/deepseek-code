import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeGuiPreferences } = require("../../../gui/kernel-host.js");

test("normalizeGuiPreferences persists language (default zh)", () => {
  assert.equal(normalizeGuiPreferences({}).language, "zh");
  assert.equal(normalizeGuiPreferences({ language: "en" }).language, "en");
  assert.equal(normalizeGuiPreferences({ language: "fr" }).language, "zh");
});

test("normalizeGuiPreferences keeps existing fields (no regression)", () => {
  const p = normalizeGuiPreferences({ theme: "day", railMode: "branches", contextCollapsed: true });
  assert.equal(p.theme, "day");
  assert.equal(p.railMode, "branches");
  assert.equal(p.contextCollapsed, true);
  assert.equal(p.language, "zh");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_GROUPS, getByPath, setByPath, coerceField, applyFieldEdit, sanitizeConfigPatch
} from "../../../gui/src/state/settings-schema.js";

test("groups cover the seven settings sections including model + about", () => {
  const ids = SETTINGS_GROUPS.map((g) => g.id);
  assert.deepEqual(ids, ["general", "model", "limits", "orchestration", "context", "experience", "about"]);
  assert.equal(SETTINGS_GROUPS.find((g) => g.id === "model").kind, "model");
  assert.equal(SETTINGS_GROUPS.find((g) => g.id === "about").kind, "about");
  // every config field carries a dot-path + a type
  for (const g of SETTINGS_GROUPS.filter((g) => g.kind === "config")) {
    for (const f of g.fields) { assert.ok(f.path.includes(".")); assert.ok(f.type); }
  }
});

test("getByPath / setByPath read + write nested paths immutably", () => {
  const cfg = { limits: { toolTimeoutMs: 120000 }, orchestration: { budget: { maxTokens: null } } };
  assert.equal(getByPath(cfg, "limits.toolTimeoutMs"), 120000);
  assert.equal(getByPath(cfg, "orchestration.budget.maxTokens"), null);
  assert.equal(getByPath(cfg, "nope.missing"), undefined);
  const next = setByPath(cfg, "orchestration.budget.maxTokens", 500);
  assert.equal(next.orchestration.budget.maxTokens, 500);
  assert.equal(cfg.orchestration.budget.maxTokens, null);       // original untouched
  assert.notEqual(next.orchestration, cfg.orchestration);       // cloned along the path
  assert.equal(next.limits, cfg.limits);                        // untouched branch shared
});

test("coerceField matches config normalizers (posInt/nullableInt/bool/enum)", () => {
  assert.equal(coerceField({ type: "posInt" }, "3"), 3);
  assert.equal(coerceField({ type: "posInt", min: 1 }, "0"), 1);          // invalid → min
  assert.equal(coerceField({ type: "posInt", min: 1 }, "abc"), 1);
  assert.equal(coerceField({ type: "nullableInt" }, ""), null);           // empty → off
  assert.equal(coerceField({ type: "nullableInt" }, "0"), null);         // ≤0 → off
  assert.equal(coerceField({ type: "nullableInt" }, "5000"), 5000);
  assert.equal(coerceField({ type: "bool" }, true), true);
  assert.equal(coerceField({ type: "bool" }, ""), false);
  assert.equal(coerceField({ type: "enum", options: ["off", "on", "gated"] }, "on"), "on");
  assert.equal(coerceField({ type: "enum", options: ["off", "on", "gated"] }, "bad"), "off");
});

test("applyFieldEdit coerces + sets; sanitizeConfigPatch drops renderer-only keys", () => {
  const draft = { orchestration: { maxRounds: 2 } };
  const next = applyFieldEdit(draft, { path: "orchestration.maxRounds", type: "posInt", min: 1 }, "5");
  assert.equal(next.orchestration.maxRounds, 5);
  const bad = applyFieldEdit(draft, { path: "orchestration.maxRounds", type: "posInt", min: 1 }, "-2");
  assert.equal(bad.orchestration.maxRounds, 1);
  assert.deepEqual(sanitizeConfigPatch({ model: "m", hasApiKey: true }), { model: "m" });
});

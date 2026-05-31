import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetForChannel,
  selectWithinBudget
} from "../../../src/context/token-budget.js";

test("budgetForChannel returns defaults and supports overrides", () => {
  assert.deepEqual(budgetForChannel("think"), { channel: "think", allocated: 12000 });
  assert.deepEqual(budgetForChannel("act"), { channel: "act", allocated: 8000 });
  assert.deepEqual(budgetForChannel("repair"), { channel: "repair", allocated: 10000 });
  assert.deepEqual(budgetForChannel("reply"), { channel: "reply", allocated: 6000 });
  assert.deepEqual(budgetForChannel("unknown", { default: 123 }), { channel: "unknown", allocated: 123 });
  assert.deepEqual(budgetForChannel("act", { act: 200 }), { channel: "act", allocated: 200 });
});

test("selectWithinBudget keeps deterministic order and skips oversized units", () => {
  const units = [
    { path: "a.js", token_count: 4 },
    { path: "b.js", token_count: 10 },
    { path: "c.js", token_count: 3 }
  ];

  const result = selectWithinBudget(units, 7);

  assert.deepEqual(result.selected.map((unit) => unit.path), ["a.js", "c.js"]);
  assert.deepEqual(result.skipped.map((unit) => unit.path), ["b.js"]);
  assert.deepEqual(result.budget, { allocated: 7, used: 7, remaining: 0 });
});

test("selectWithinBudget rejects negative budgets", () => {
  assert.throws(
    () => selectWithinBudget([], -1),
    /budget must be a non-negative number/
  );
});

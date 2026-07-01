import test from "node:test";
import assert from "node:assert/strict";
import { menuModel } from "../../../gui/src/state/menu-model.js";

test("menu groups expose action ids", () => {
  const m = menuModel((k) => k);
  assert.ok(m.find((g) => g.items.some((i) => i.id === "file.save")));
  assert.ok(m.find((g) => g.items.some((i) => i.id === "view.settings")));
  assert.ok(m.find((g) => g.items.some((i) => i.id === "help.about")));
  assert.ok(m.every((g) => Array.isArray(g.items)));
});

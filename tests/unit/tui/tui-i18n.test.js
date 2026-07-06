import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS, makeT } from "../../../src/apps/tui/tui-i18n.js";

test("zh/en dictionaries expose identical key sets", () => {
  assert.deepEqual(Object.keys(STRINGS.zh).sort(), Object.keys(STRINGS.en).sort());
});

test("t interpolates and falls back", () => {
  const t = makeT("zh");
  assert.equal(t("msg.modeSet", { mode: "auto" }), "模式:auto");
  assert.equal(makeT("en")("msg.modeSet", { mode: "auto" }), "mode: auto");
  assert.equal(t("__nope__"), "__nope__");
});

test("unknown lang falls back to zh dictionary", () => {
  assert.equal(makeT("fr")("status.lang"), "中文");
});

import test from "node:test";
import assert from "node:assert/strict";
import { translate, makeT } from "../../../gui/src/i18n/strings.js";

test("translate returns zh/en by language, falls back to zh then key", () => {
  assert.equal(translate("zh", "composer.send"), "发送");
  assert.equal(translate("en", "composer.send"), "Send");
  assert.equal(translate("fr", "composer.send"), "发送"); // unknown lang → zh
  assert.equal(translate("en", "___missing___"), "___missing___"); // unknown key → key
});

test("makeT binds a language", () => {
  const t = makeT("en");
  assert.equal(t("approval.approve"), "Approve");
  assert.equal(makeT("zh")("approval.approve"), "批准");
});

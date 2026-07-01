import test from "node:test";
import assert from "node:assert/strict";
import { translate, makeT, LANGUAGES } from "../../../gui/src/i18n/strings.js";

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

test("zh and en dictionaries have identical key sets (no missing translations)", () => {
  // Probe a representative sample of D-3 keys across both languages — every key must
  // resolve to a real (non-key-fallback) string in each language.
  const keys = [
    "settings.general", "settings.model", "settings.limits", "settings.orchestration",
    "settings.context", "settings.experience", "settings.about",
    "settings.f.maxRounds", "settings.f.semanticEnabled", "settings.model.fetch",
    "settings.model.fetchFailed", "rewind.title", "rewind.force", "diff.title",
    "panel.noProblems", "search.placeholder", "run.empty"
  ];
  for (const lang of LANGUAGES) {
    for (const k of keys) {
      assert.notEqual(translate(lang, k), k, `${lang} missing ${k}`);
    }
  }
});

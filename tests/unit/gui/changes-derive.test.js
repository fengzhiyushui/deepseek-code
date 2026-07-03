import test from "node:test";
import assert from "node:assert/strict";
import { deriveChangeEntries, statusLetter, clampLine, shortTime } from "../../../gui/src/state/changes-derive.js";

test("deriveChangeEntries: source tag, normalization, rollback flag", () => {
  const entries = deriveChangeEntries([
    { id: "c2", time: "2026-07-02T10:00:00.000Z", prompt: "GUI edit src/a.js", rolledBack: false,
      files: [{ path: "src/a.js", status: "modify", added: 2, removed: 1, hunkStarts: [1] }] },
    { id: "c1", time: "2026-07-02T09:00:00.000Z", prompt: "fix login bug", rolledBack: true,
      files: [{ path: "src/auth.js", status: "create", added: null, removed: null, hunkStarts: null }] },
    null,
    { time: "no-id-dropped" }
  ]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, "manual");
  assert.equal(entries[1].source, "agent");
  assert.equal(entries[1].rolledBack, true);
  assert.match(entries[0].timeShort, /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(entries[0].files[0].added, 2);
  assert.equal(entries[1].files[0].added, null);
});

test("long prompt truncated with ellipsis; bad time → empty", () => {
  const [e] = deriveChangeEntries([{ id: "c", time: "bogus", prompt: "x".repeat(80), files: [] }]);
  assert.equal(e.timeShort, "");
  assert.ok(e.promptShort.length <= 42);
  assert.ok(e.promptShort.endsWith("…"));
  assert.equal(shortTime("not-a-date"), "");
});

test("statusLetter + clampLine", () => {
  assert.equal(statusLetter("create"), "A");
  assert.equal(statusLetter("delete"), "D");
  assert.equal(statusLetter("modify"), "M");
  assert.equal(clampLine(7, 100), 7);
  assert.equal(clampLine(999, 10), 10);
  assert.equal(clampLine(0, 10), 1);
  assert.equal(clampLine(NaN, 10), 1);
});

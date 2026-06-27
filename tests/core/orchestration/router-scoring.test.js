import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFileToken, extractFeatures, computeScore, classifyBand, featuresForEvent,
  STRONG_MARKERS, DEFAULT_WEAK_MARKERS
} from "../../../src/core/orchestration/router-scoring.js";

test("normalizeFileToken unifies separators/case/leading-dot", () => {
  assert.equal(normalizeFileToken("src\\foo.ts"), "src/foo.ts");
  assert.equal(normalizeFileToken("SRC/Foo.ts"), "src/foo.ts");
  assert.equal(normalizeFileToken("./a//b.js"), "a/b.js");
});

test("extractFeatures dedupes file tokens by normalized key", () => {
  const f = extractFeatures("touch src/foo.ts and src\\foo.ts", {}, { markers: DEFAULT_WEAK_MARKERS });
  assert.deepEqual(f.files, ["src/foo.ts"]);            // same path, both separators → 1
});

test("extractFeatures captures globs", () => {
  const f = extractFeatures("rename all *.ts under src/**", {}, { markers: DEFAULT_WEAK_MARKERS });
  assert.ok(f.files.includes("*.ts"));
  assert.ok(f.files.includes("src/**"));
});

test("computeScore: strong+2 weak+1 file+1(cap3) longEdit+1", () => {
  const strong = extractFeatures("迁移 重构整个", {}, { markers: [] });
  assert.equal(computeScore(strong), 4);               // 2 strong markers
  const weak = extractFeatures("这些 分别", {}, { markers: DEFAULT_WEAK_MARKERS });
  assert.equal(computeScore(weak), 2);                 // 2 weak
  const files = extractFeatures("a.ts b.ts c.ts d.ts", {}, { markers: [] });
  assert.equal(computeScore(files), 3);                // 4 files capped at 3
});

test("longEdit only for edit task_type and length>=80", () => {
  const long = "Please refactor and clean up the authentication module thoroughly and add input validation everywhere now";
  const f = extractFeatures(long, {}, { markers: [] });
  assert.equal(f.longEdit, true);
  assert.equal(computeScore(f), 1);                    // longEdit only, no markers/files
  const shortQ = extractFeatures("what is x?", {}, { markers: [] });
  assert.equal(shortQ.longEdit, false);
});

test("classifyBand boundaries", () => {
  assert.equal(classifyBand(0, 3), "simple");
  assert.equal(classifyBand(2, 3), "ambiguous");
  assert.equal(classifyBand(3, 3), "complex");
});

test("featuresForEvent redacts: counts + capped lists, no raw message", () => {
  const f = extractFeatures("迁移 a.ts b.ts c.ts d.ts", {}, { markers: [] });
  const ev = featuresForEvent(f);
  assert.equal(ev.fileScore, 3);
  assert.ok(ev.files.length <= 8);
  assert.equal(typeof ev.weak, "number");
  assert.ok(!("classification" in ev));                // no raw/derived message data
});

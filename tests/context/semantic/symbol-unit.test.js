import { test } from "node:test";
import assert from "node:assert/strict";
import { createSymbolUnit } from "../../../src/context/semantic/symbol-unit.js";

const symbol = { symbol_id: "src/a.js#function:main:2", file: "src/a.js", name: "main", kind: "function", range: { start_line: 2, end_line: 3 }, exported: true };
const source = "line1\nfunction main() {\n  return 1;\n}\nline5\n";

test("symbol unit slices the symbol's line range", () => {
  const u = createSymbolUnit({ symbol, source, priority: 1, reason: "seed" });
  assert.equal(u.type, "symbol");
  assert.equal(u.path, "src/a.js");
  assert.equal(u.symbol_id, symbol.symbol_id);
  assert.deepEqual(u.defined_in, { start_line: 2, end_line: 3 });
  assert.equal(u.snippet, "function main() {\n  return 1;");
  assert.ok(u.token_count > 0);
  assert.ok(u.hash.startsWith("sha256:"));
});

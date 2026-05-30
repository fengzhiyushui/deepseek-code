import test from "node:test";
import assert from "node:assert/strict";
import {
  validateToolParams,
  toDeepSeekToolSchema
} from "../../../src/tools/schema.js";

const schema = {
  path: { type: "string" },
  mode: { type: "string", enum: ["read", "write"], default: "read" },
  limit: { type: "number", required: false },
  tags: { type: "array", required: false },
  internal_flag: { type: "boolean", required: false, internal: true }
};

test("validateToolParams accepts required params and applies defaults", () => {
  const params = validateToolParams("memory", schema, { path: "README.md" });
  assert.deepEqual(params, { path: "README.md", mode: "read" });
});

test("validateToolParams rejects missing required params", () => {
  assert.throws(
    () => validateToolParams("read", schema, {}),
    /missing required param: path/
  );
});

test("validateToolParams rejects unknown params", () => {
  assert.throws(
    () => validateToolParams("read", schema, { path: "README.md", extra: true }),
    /unknown param/
  );
});

test("validateToolParams checks type and enum", () => {
  assert.throws(() => validateToolParams("read", schema, { path: 3 }), /must be string/);
  assert.throws(() => validateToolParams("read", schema, { path: "a", mode: "delete" }), /must be one of/);
});

test("toDeepSeekToolSchema emits function tool schema", () => {
  const tool = toDeepSeekToolSchema({
    name: "read",
    description: "Read file",
    params: schema
  });

  assert.equal(tool.type, "function");
  assert.equal(tool.function.name, "read");
  assert.deepEqual(tool.function.parameters.required, ["path"]);
  assert.equal(tool.function.parameters.properties.mode.default, "read");
  assert.equal(tool.function.parameters.properties.internal_flag, undefined);
});

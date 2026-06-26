import { test } from "node:test";
import assert from "node:assert/strict";
import { createParserRegistry, extensionOf } from "../../../src/context/semantic/parser-provider.js";

test("extensionOf returns lowercased extension with dot", () => {
  assert.equal(extensionOf("src/A.TS"), ".ts");
  assert.equal(extensionOf("noext"), "");
});

test("registry routes by extension, null when unsupported", () => {
  const fake = { name: "fake", supports: (e) => e === ".js", load: async () => {}, parse: () => ({}) };
  const reg = createParserRegistry({ providers: [fake] });
  assert.equal(reg.providerForExtension(".js"), fake);
  assert.equal(reg.providerForExtension(".py"), null);
  assert.deepEqual(reg.list().map((p) => p.name), ["fake"]);
});

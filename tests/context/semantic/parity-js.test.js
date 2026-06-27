import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractParseResult as oldExtract } from "../../../src/context/semantic/js-ts-extractor.js";
import { extractWithDef } from "../../../src/context/semantic/query-extractor.js";
import { jsLanguageDef } from "../../../src/context/semantic/languages/javascript.js";

// Shadow-parity corpus: covers the §4.4 checklist forms. Each fixture's
// query-extractor output must be MULTISET-equal to the legacy js-ts-extractor.
// NOTE on enclosing-symbol: the runner attributes calls by *byte* range; the
// legacy extractor uses *line* range with first-wins ties. These diverge ONLY
// when two symbols share an identical line range (same-line nesting), where the
// byte rule is strictly more correct. The nested fixture below is therefore
// written multi-line so both rules agree — parity tests realistic code.
const CORPUS = [
  `import { foo as bar, baz } from "./m.js";\nimport def from "./d.js";\nimport * as ns from "./n.js";`,
  `export function main(){ foo(); obj.run(); a.b.c(); plain(); obj["x"](); }\nexport class Service {}`,
  `export default function named(){}\nexport default function(){}\nexport default class {}`,
  `export { foo as bar, baz };\nexport * from "./re.js";`,
  `const arrow = () => {};\nconst fn = function(){};\nfunction outer(){\n  function inner(){ helper(); }\n}`,
  `const x = require("./cjs.js");\nimport("./dyn.js");\nmodule.exports = {};\nexports.y = 1;`
];

function ms(list) {
  // canonical multiset: stable-serialize each element (sorted keys), then sort
  return list.map((e) => JSON.stringify(e, Object.keys(e).sort())).sort();
}

const provider = createWasmTreeSitterProvider();

test("JS query-extractor is multiset-equal to js-ts-extractor across the corpus", async () => {
  await provider.load();
  const query = provider.compileQuery("js", jsLanguageDef.query);
  for (const [i, source] of CORPUS.entries()) {
    const file = `src/c${i}.js`;
    const oldR = oldExtract({ file, source, parseTree: (f, s) => provider.parseTree(f, s) });
    const { tree } = provider.parseTree(file, source);
    const newR = extractWithDef({ file, source, tree, query, def: jsLanguageDef });
    for (const field of ["symbols", "imports", "exports", "calls"]) {
      assert.deepEqual(ms(newR[field]), ms(oldR[field]), `field=${field} fixture=${i}`);
    }
  }
});

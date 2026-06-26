import Parser from "web-tree-sitter";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const grammarDir = path.join(dir, "..", "src", "context", "grammars");

await Parser.init();

const samples = [
  {
    name: "javascript",
    file: "tree-sitter-javascript.wasm",
    source: "export function main(){ foo(); }",
  },
  {
    name: "typescript",
    file: "tree-sitter-typescript.wasm",
    source: "export function main(value: string): void { console.log(value); }",
  },
  {
    name: "tsx",
    file: "tree-sitter-tsx.wasm",
    source: "export const App = () => <main>Hello</main>;",
  },
];

const results = [];

for (const sample of samples) {
  const parser = new Parser();
  const language = await Parser.Language.load(path.join(grammarDir, sample.file));
  parser.setLanguage(language);
  const tree = parser.parse(sample.source);
  results.push(`${sample.name}=${tree.rootNode.type}:${tree.rootNode.namedChildCount}`);
}

console.log("root:", results.join(" "));

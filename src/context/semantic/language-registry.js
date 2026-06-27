// Maps a language id (as produced by the provider's parseTree) to its
// query-extractor languageDef. The query-extractor looks a def up here per file;
// languages without a def degrade to ok:false (skipped, never crash).
import { jsLanguageDef } from "./languages/javascript.js";
import { tsLanguageDef } from "./languages/typescript.js";

export function createLanguageRegistry() {
  const m = new Map();
  m.set("js", jsLanguageDef);
  m.set("ts", tsLanguageDef);
  return m;
}

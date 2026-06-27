// TS language definition. The tree-sitter-typescript grammar shares node names
// with JS for all forms we model (function/class/method/variable declarations,
// imports/exports, calls), so the JS def's query + handleMatch apply verbatim;
// only `language` differs. TS-only nodes (interface_declaration, type_alias_
// declaration, enums, …) are simply not captured → maintained-not-modeled,
// matching js-ts-extractor's behavior on .ts sources.
import { jsLanguageDef } from "./javascript.js";

export const tsLanguageDef = { ...jsLanguageDef, language: "ts" };

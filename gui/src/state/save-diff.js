// Whole-file unified diff for a GUI save (before → after). Fed to editService.apply so
// GUI edits share the agent's transactional/rollback pipeline. Pure — node:test-covered.
export function wholeFileDiff(filePath, before, after) {
  const b = String(before ?? "");
  const a = String(after ?? "");
  if (b === a) return "";
  const bl = b === "" ? [] : b.split("\n");
  const al = a === "" ? [] : a.split("\n");
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const hunk = `@@ -1,${bl.length} +1,${al.length} @@\n`;
  const body = bl.map((l) => `-${l}`).concat(al.map((l) => `+${l}`)).join("\n");
  return `${header}${hunk}${body}\n`;
}

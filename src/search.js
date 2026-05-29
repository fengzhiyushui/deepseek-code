import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listProjectFiles, readTextFile } from "./context.js";

const execFileAsync = promisify(execFile);

export async function searchProject(root, pattern, options = {}) {
  const maxMatches = options.maxMatches ?? 80;
  const rgMatches = await searchWithRipgrep(root, pattern, maxMatches);
  if (rgMatches) {
    return rgMatches;
  }
  return searchWithNode(root, pattern, maxMatches);
}

async function searchWithRipgrep(root, pattern, maxMatches) {
  try {
    const { stdout } = await execFileAsync("rg", [
      "--json",
      "--max-count",
      String(maxMatches),
      "--",
      pattern,
      "."
    ], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000,
      windowsHide: true
    });

    return stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.type === "match")
      .slice(0, maxMatches)
      .map((event) => ({
        path: event.data.path.text,
        line: event.data.line_number,
        column: event.data.submatches?.[0]?.start + 1 || 1,
        text: event.data.lines.text.trimEnd()
      }));
  } catch (error) {
    if (error.code === 1) {
      return [];
    }
    return null;
  }
}

async function searchWithNode(root, pattern, maxMatches) {
  const files = await listProjectFiles(root, { maxFiles: 2000 });
  const matches = [];
  const needle = pattern.toLowerCase();

  for (const file of files) {
    if (matches.length >= maxMatches) {
      break;
    }
    let content = "";
    try {
      content = await readTextFile(root, file, 500_000);
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const column = lines[index].toLowerCase().indexOf(needle);
      if (column !== -1) {
        matches.push({
          path: file,
          line: index + 1,
          column: column + 1,
          text: lines[index]
        });
        if (matches.length >= maxMatches) {
          break;
        }
      }
    }
  }

  return matches;
}

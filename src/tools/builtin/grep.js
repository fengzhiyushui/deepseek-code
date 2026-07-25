import { readWorkspaceTextFile, walkWorkspaceFiles } from "../../workspace/path-safety.js";

export function createGrepTool({
  now = Date.now,
  totalTimeoutMs = 10_000,
  perFileTimeoutMs = 2_000
} = {}) {
  return {
    name: "grep",
    description: "Search workspace text files with a JavaScript regular expression",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.1",
    params: {
      pattern: { type: "string", description: "Regular expression pattern" },
      path: { type: "string", default: ".", description: "Workspace-relative path to search" },
      max_matches: { type: "number", required: false, default: 200 }
    },
    execute: async (params, context) => {
      const regex = new RegExp(params.pattern);
      const files = await walkWorkspaceFiles(context.projectRoot, params.path);
      const matches = [];
      const totalStart = now();
      let filesSearched = 0;
      let filesSkippedTimeout = 0;
      let timedOutScope = null;

      for (const filePath of files) {
        if (matches.length >= params.max_matches) break;
        if (now() - totalStart >= totalTimeoutMs) {
          timedOutScope = "total";
          break;
        }
        let file;
        try {
          file = await readWorkspaceTextFile(context.projectRoot, filePath, { maxBytes: 1024 * 1024 });
        } catch {
          continue;
        }
        filesSearched += 1;
        const fileStart = now();
        const lines = file.content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (index % 64 === 0 || index === 0) {
            if (now() - totalStart >= totalTimeoutMs) {
              timedOutScope = "total";
              break;
            }
            if (now() - fileStart >= perFileTimeoutMs) {
              filesSkippedTimeout += 1;
              break;
            }
          }
          if (regex.test(lines[index])) {
            matches.push(`${filePath}:${index + 1}:${lines[index]}`);
            if (matches.length >= params.max_matches) break;
          }
        }
        if (timedOutScope === "total") break;
      }

      const timed_out = timedOutScope != null || filesSkippedTimeout > 0;
      const timed_out_scope = timedOutScope ?? (filesSkippedTimeout > 0 ? "file" : null);
      return {
        content: [{ type: "text", text: matches.join("\n") }],
        metadata: {
          matches: matches.length,
          timed_out,
          timed_out_scope,
          files_skipped_timeout: filesSkippedTimeout,
          files_searched: filesSearched
        }
      };
    }
  };
}

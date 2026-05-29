import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function showDiff(root) {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    if (error.stderr?.includes("not a git repository")) {
      return "";
    }
    throw new Error(`git diff 执行失败：${error.message}`);
  }
}

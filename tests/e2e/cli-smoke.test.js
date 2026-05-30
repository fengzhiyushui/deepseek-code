import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runKernelAgentCommand } from "../../src/apps/cli/kernel-runner.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = path.join(repoRoot, "bin", "deepseek-code.js");

test("CLI test command propagates child process exit code", () => {
  const child = spawnSync(
    process.execPath,
    [binPath, "test", process.execPath, "-e", "process.exit(7)"],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.equal(child.status, 7, `stdout:\n${child.stdout}\nstderr:\n${child.stderr}`);
});

test("CLI ask runner can complete offline without JSON mode failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-cli-ask-"));
  const lines = [];
  const result = await runKernelAgentCommand({
    root,
    prompt: "你好",
    write: (line) => lines.push(line),
    createKernelImpl: async () => ({
      session: {
        subscribe(handler) {
          handler({ type: "agent:final", content: "你好，我是 DeepSeek Code。" });
          return { unsubscribe() {} };
        }
      },
      agent: {
        send: async () => ({ status: "complete", content: "你好，我是 DeepSeek Code。" })
      }
    })
  });

  assert.equal(result.status, "complete");
  assert.equal(lines.some((line) => /response_format|json_object|Prompt must contain/i.test(line)), false);
  assert.ok(lines.some((line) => line.includes("你好，我是 DeepSeek Code。")));
});

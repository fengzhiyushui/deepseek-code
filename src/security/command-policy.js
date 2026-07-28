// 命令级策略分类器(设计 §3.3):清单硬编码,不开用户配置面。
// 纯函数、零依赖、不 throw;异常 argv 防御性归 dangerous(上游 normalizeShellParams 保证正常路径非空)。

const FORBIDDEN_COMMANDS = new Set(["format", "diskpart", "bcdedit", "dd"]);

const DANGEROUS_COMMANDS = new Set([
  "rm", "rmdir", "rd", "del",
  "shutdown", "reg", "sc", "schtasks", "taskkill",
  "curl", "wget",
  "bash", "sh", "zsh", "dash", "cmd", "powershell", "pwsh"
]);

const INTERPRETER_EVAL_FLAGS = new Map([
  ["node", ["-e", "--eval", "-p", "--print"]],
  ["python", ["-c"]],
  ["python3", ["-c"]],
  ["ruby", ["-e"]],
  ["perl", ["-e"]]
]);

const GIT_PUSH_DANGEROUS_FLAGS = ["--force", "--force-with-lease", "--delete"];
// git 短选项可打包(`push -fu`),逐字符判定才能覆盖 `-f`/`-d` 的全部写法。
const GIT_PUSH_DANGEROUS_SHORT = /^-[a-z0-9]*[fd][a-z0-9]*$/;

export function classifyCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((entry) => typeof entry === "string")) {
    return "dangerous";
  }
  const name = normalizeCommandName(argv[0]);
  const rest = argv.slice(1).map((entry) => entry.toLowerCase());

  if (FORBIDDEN_COMMANDS.has(name) || name.startsWith("mkfs")) return "forbidden";
  if (DANGEROUS_COMMANDS.has(name)) return "dangerous";
  const evalFlags = INTERPRETER_EVAL_FLAGS.get(name);
  if (evalFlags && rest.some((arg) => evalFlags.some((flag) => matchesFlag(arg, flag)))) return "dangerous";
  if (name === "npm" && rest.includes("publish")) return "dangerous";
  if (name === "git" && rest.includes("push") && rest.some(isGitPushDangerousFlag)) return "dangerous";
  return "safe";
}

// `--flag=value` 与 `--flag value` 对解析器等价,只比对相等会漏(如 `node --eval=...`)。
function matchesFlag(arg, flag) {
  return arg === flag || arg.startsWith(`${flag}=`);
}

function isGitPushDangerousFlag(arg) {
  return GIT_PUSH_DANGEROUS_FLAGS.some((flag) => matchesFlag(arg, flag)) || GIT_PUSH_DANGEROUS_SHORT.test(arg);
}

// Win32 解析路径前会剥掉结尾的点与空白(`cmd.` 照样启动 cmd.exe),归一化必须同步剥,否则全部规则可绕。
function normalizeCommandName(entry) {
  const basename = entry.split(/[\\/]/).pop().toLowerCase().replace(/[.\s]+$/, "");
  return basename.replace(/\.(exe|cmd|bat|com)$/, "").replace(/[.\s]+$/, "");
}

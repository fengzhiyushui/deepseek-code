import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { askCommand, editCommand } from "./agent.js";
import { chatCommand } from "./chat.js";
import { formatChange, listChanges, rollbackChange } from "./changes.js";
import { configureProject, DEFAULT_CONFIG, loadConfig } from "./config.js";
import { buildProjectContext } from "./context.js";
import { showDiff } from "./git.js";
import { testDeepSeekConnection } from "./provider.js";
import { searchProject } from "./search.js";
import { banner, color, section, statusLine } from "./theme.js";
import { createKernel } from "./index.js";
import { buildKernelOptions } from "./apps/kernel-options.js";

// --- Status Bar Helpers (if kernel available) ---

function renderStatusLine(kernel) {
  if (!kernel) return "";

  const state = kernel.runtime?.getState?.() || { current: "idle", channel: null };
  const publicConfig = kernel.config?.getPublicConfig?.() || {};

  const parts = [
    color.dim("|"),
    ` ${state.current || "idle"} `,
    color.dim("|"),
    ` ${state.channel || "-"} `,
    color.dim("|"),
    ` ${publicConfig.runtime || "v2"} `
  ];

  parts.push(color.dim("|"));
  return parts.join("");
}

// --- Timeline helpers ---

const timelineBuffer = [];

function summarizeTuiEvent(event = {}) {
  if (event.type === "user:message") return `input: ${(event.content || "").slice(0, 50)}`;
  if (event.type === "tool:call") return `tool: ${event.call?.name || event.tool || "unknown"}`;
  if (event.type === "tool:result") return `tool result: ${event.result?.status || "unknown"}`;
  if (event.type === "approval:requested") return `approval: ${event.approval?.summary || event.approval?.id || ""}`;
  if (event.type === "file:diff_applied") return `diff applied: ${event.change_id || event.record?.id || ""}`;
  if (event.type === "verification:result") return `verification: ${event.result?.status || event.status || "unknown"}`;
  if (event.type === "agent:final") return `complete: ${(event.content || "").slice(0, 50)}`;
  if (event.type === "agent:error") return `Error: ${event.message || event.error || ""}`;
  return event.type || "event";
}

async function sendKernelPrompt(kernel, prompt, options = {}) {
  if (!kernel) {
    throw new Error("V2 kernel is not available.");
  }
  let result = await kernel.agent.send(prompt, options);
  if (result.status === "awaiting_approval") {
    const answer = await promptLine(`Approval required ${result.approval?.id || "unknown"}. Approve? y/N`);
    const normalized = String(answer || "").trim().toLowerCase();
    const decision = normalized === "y" || normalized === "yes" || normalized === "approve" || normalized === "allow"
      ? "approve"
      : "deny";
    result = await kernel.agent.approve(result.approval.id, decision);
  }
  return result.content || "";
}

function recordTimelineEvent(type, summary) {
  timelineBuffer.push({ time: new Date().toISOString(), type, summary });
  if (timelineBuffer.length > 50) timelineBuffer.shift();
}

function renderTimeline(count = 5) {
  const recent = timelineBuffer.slice(-count);
  if (!recent.length) return "";

  const lines = ["", color.dim("── Recent Activity ──")];
  for (const e of recent) {
    const icon = {
      "user:message": "U",
      "tool:call": "T",
      "tool:result": "R",
      "permission:decision": "P",
      "approval:requested": "A",
      "file:diff_applied": "D",
      "verification:result": "V",
      "agent:final": "F",
      "agent:error": "E"
    }[e.type] || "-";
    const time = new Date(e.time).toLocaleTimeString();
    lines.push(color.dim(`${time} ${icon} ${e.summary}`));
  }
  return lines.join("\n");
}

const ACTIONS = [
  {
    id: "ask",
    label: "向 DeepSeek 提问",
    hint: "基于当前项目上下文回答问题"
  },
  {
    id: "chat",
    label: "连续对话",
    hint: "保留上下文进行多轮交流"
  },
  {
    id: "edit",
    label: "生成补丁修改",
    hint: "生成 diff，确认后再写入文件"
  },
  {
    id: "search",
    label: "搜索项目代码",
    hint: "在当前项目里查找关键词"
  },
  {
    id: "scan",
    label: "扫描项目上下文",
    hint: "查看已索引的项目文件"
  },
  {
    id: "test",
    label: "运行测试",
    hint: "运行 node --test"
  },
  {
    id: "diff",
    label: "查看 Git 差异",
    hint: "显示当前仓库改动"
  },
  {
    id: "changes",
    label: "查看修改记录",
    hint: "查看最近的补丁详情"
  },
  {
    id: "rollback",
    label: "回退最近修改",
    hint: "恢复最近一次已记录的修改"
  },
  {
    id: "config",
    label: "配置 API 密钥",
    hint: "写入 DeepSeek 密钥、模型和接口地址"
  },
  {
    id: "config-test",
    label: "测试 API 连接",
    hint: "验证当前 DeepSeek 配置是否可用"
  },
  {
    id: "quit",
    label: "退出",
    hint: "离开终端界面"
  }
];

export async function runTui(root, kernel = null) {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("TUI 需要在交互式终端中运行。");
  }

  // Create kernel if not provided
  let ownKernel = false;
  if (!kernel) {
    try {
      kernel = await createKernel(root, await buildKernelOptions(root));
      ownKernel = true;
    } catch (err) {
      // If kernel creation fails (e.g., no API key), run without it
      // Status bar and timeline will be disabled
    }
  }

  const state = {
    cursor: 0,
    message: "准备就绪。",
    busy: false
  };

  // Subscribe to orchestrator state events
  let sessionSub = null;
  if (kernel) {
    sessionSub = kernel.session.subscribe((event) => {
      recordTimelineEvent(event.type, summarizeTuiEvent(event));
    });
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  hideCursor();

  try {
    while (true) {
      render(state, kernel);
      const key = await readKey();
      if (key === "\u0003" || key === "q") {
        break;
      }
      if (key === "\u001b[A") {
        state.cursor = (state.cursor - 1 + ACTIONS.length) % ACTIONS.length;
        continue;
      }
      if (key === "\u001b[B") {
        state.cursor = (state.cursor + 1) % ACTIONS.length;
        continue;
      }
      if (key === "\r" || key === "\n") {
        const action = ACTIONS[state.cursor];
        if (action.id === "quit") {
          break;
        }
        await runAction(root, action, state, kernel);
      }
    }
  } finally {
    if (sessionSub) sessionSub.unsubscribe();
    showCursor();
    clear();
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function runAction(root, action, state, kernel) {
  state.busy = true;
  state.message = `正在执行：${action.label}...`;
  render(state, kernel);

  try {
    if (action.id === "ask") {
      const prompt = await promptLine("请输入问题");
      if (!prompt) {
        state.message = "已取消。";
        return;
      }
      recordTimelineEvent("user:message", "提问: " + (prompt || "").slice(0, 50));
      const answer = await withCookedInput(() => sendKernelPrompt(kernel, prompt, { autonomy: "gated" }));
      await pauseWithOutput("回答结果", answer);
      state.message = "提问已完成。";
      return;
    }

    if (action.id === "chat") {
      recordTimelineEvent("user:message", "开始连续对话");
      const answer = await withCookedInput(() => chatCommand({
        root,
        prompt: "",
        options: defaultOptions()
      }));
      await pauseWithOutput("连续对话", answer);
      state.message = "连续对话已结束。";
      return;
    }

    if (action.id === "edit") {
      const prompt = await promptLine("请输入修改需求");
      if (!prompt) {
        state.message = "已取消。";
        return;
      }
      recordTimelineEvent("user:message", "修改: " + (prompt || "").slice(0, 50));
      const files = await promptLine("相关文件，多个文件用英文逗号分隔");
      const fileHint = splitFiles(files).length ? `\n\nRelevant files: ${splitFiles(files).join(", ")}` : "";
      const answer = await withCookedInput(() => sendKernelPrompt(kernel, `${prompt}${fileHint}`, { autonomy: "supervised" }));
      await pauseWithOutput("修改结果", answer);
      state.message = "修改流程已完成。";
      return;
    }

    if (action.id === "search") {
      const pattern = await promptLine("请输入搜索关键词");
      if (!pattern) {
        state.message = "已取消。";
        return;
      }
      recordTimelineEvent("user:message", "搜索: " + (pattern || "").slice(0, 50));
      const matches = await searchProject(root, pattern, { maxMatches: 80 });
      const output = matches.length
        ? matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.text}`).join("\n")
        : "没有找到匹配结果。";
      await pauseWithOutput("搜索结果", output);
      state.message = "搜索已完成。";
      return;
    }

    if (action.id === "scan") {
      recordTimelineEvent("user:message", "扫描项目上下文");
      const context = await buildProjectContext(root, defaultOptions());
      await pauseWithOutput("项目上下文", context.indexText);
      state.message = "扫描已完成。";
      return;
    }

    if (action.id === "test") {
      recordTimelineEvent("user:message", "运行测试");
      await withCookedInput(() => runTest(root));
      await pause("测试已结束。按回车返回。");
      state.message = "测试命令已完成。";
      return;
    }

    if (action.id === "diff") {
      recordTimelineEvent("user:message", "查看Git差异");
      const diff = await showDiff(root);
      await pauseWithOutput("Git 差异", diff || "没有可显示的 Git 差异。");
      state.message = "差异查看已完成。";
      return;
    }

    if (action.id === "changes") {
      recordTimelineEvent("user:message", "查看修改记录");
      const records = await listChanges(root, 5);
      const output = records.length
        ? records.map((record) => formatChange(record)).join("\n\n---\n\n")
        : "还没有修改记录。";
      await pauseWithOutput("修改记录", output);
      state.message = "修改记录已显示。";
      return;
    }

    if (action.id === "rollback") {
      const sure = await promptLine("确认回退最近一次修改？输入 yes 确认");
      if (sure !== "yes") {
        state.message = "已取消回退。";
        return;
      }
      recordTimelineEvent("user:message", "回退修改");
      const record = await rollbackChange(root, "latest");
      await pauseWithOutput("回退结果", `已回退变更：${record.id}`);
      state.message = "回退已完成。";
      return;
    }

    if (action.id === "config") {
      recordTimelineEvent("user:message", "配置API密钥");
      const output = await configureFromTui(root);
      await pauseWithOutput("配置结果", output);
      state.message = "配置已保存。";
      return;
    }

    if (action.id === "config-test") {
      recordTimelineEvent("user:message", "测试API连接");
      const config = await loadConfig(root);
      await withCookedInput(() => testDeepSeekConnection(config));
      await pauseWithOutput("连接测试", "DeepSeek API 连接测试通过。");
      state.message = "连接测试已完成。";
    }
  } catch (error) {
    recordTimelineEvent("tool:result", "错误: " + (error?.message || String(error)).slice(0, 60));
    await pauseWithOutput("错误", error?.message || String(error));
    state.message = "操作失败。";
  } finally {
    state.busy = false;
  }
}

async function configureFromTui(root) {
  const current = await loadConfig(root, { allowMissingKey: true });
  const apiKey = await promptSecret("请输入 DeepSeek API 密钥，留空则保留当前值");
  const model = await promptLine(`模型，留空使用 ${current.model || DEFAULT_CONFIG.model}`);
  const baseUrl = await promptLine(`接口地址，留空使用 ${current.baseUrl || DEFAULT_CONFIG.baseUrl}`);
  const thinking = await promptLine("是否启用 thinking，输入 y/是 启用，留空关闭");
  const reasoningEffort = await promptLine("推理强度 minimal/high/max，留空使用 high");

  const { target, config } = await configureProject(root, {
    apiKey: apiKey || current.apiKey,
    model: model || current.model || DEFAULT_CONFIG.model,
    baseUrl: baseUrl || current.baseUrl || DEFAULT_CONFIG.baseUrl,
    thinking: isAffirmative(thinking) ? { type: "enabled" } : { type: "disabled" },
    reasoningEffort: reasoningEffort || current.reasoningEffort || DEFAULT_CONFIG.reasoningEffort
  });

  return [
    `已写入：${target}`,
    `模型：${config.model}`,
    `接口地址：${config.baseUrl}`,
    `thinking：${config.thinking.type}`,
    `推理强度：${config.reasoningEffort}`,
    `API 密钥：${config.apiKey ? maskKey(config.apiKey) : "未设置"}`
  ].join("\n");
}

async function runTest(root) {
  return new Promise((resolve) => {
    const child = spawn("node", ["--test"], {
      cwd: root,
      stdio: "inherit",
      shell: false
    });
    child.on("close", resolve);
  });
}

function render(state, kernel) {
  clear();
  const rows = process.stdout.rows || 30;
  console.log(banner());
  console.log("");
  console.log(statusLine("项目根目录", process.cwd()));
  console.log(statusLine("当前模式", state.busy ? color.yellow("执行中") : color.green("交互模式")));
  console.log(statusLine("操作提示", "方向键选择，回车执行，q 退出"));
  console.log("");
  console.log(section("功能选项"));
  console.log("");

  ACTIONS.forEach((action, index) => {
    const selected = index === state.cursor;
    const marker = selected ? ">" : " ";
    const label = selected ? color.inverse(` ${action.label} `) : ` ${action.label} `;
    console.log(`${marker} ${label.padEnd(26)} ${color.dim(action.hint)}`);
  });

  const usedRows = 9 + ACTIONS.length;
  const spacer = Math.max(1, rows - usedRows - 2);
  for (let index = 0; index < spacer; index += 1) {
    console.log("");
  }

  // Timeline (if kernel available)
  if (kernel) {
    console.log(renderTimeline(3));
  }

  // Status line
  if (kernel) {
    console.log("");
    console.log(renderStatusLine(kernel));
  }

  console.log(color.dim(state.message));
}

function clear() {
  stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  stdout.write("\x1b[?25l");
}

function showCursor() {
  stdout.write("\x1b[?25h");
}

function readKey() {
  return new Promise((resolve) => {
    stdin.once("data", resolve);
  });
}

async function promptLine(label) {
  return withCookedInput(async () => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = await rl.question(`${label}: `);
      return answer.trim();
    } finally {
      rl.close();
    }
  });
}

async function promptSecret(label) {
  return withCookedInput(async () => {
    const rl = createInterface({ input: stdin, output: stdout });
    const originalWrite = stdout.write;
    try {
      stdout.write = function maskedWrite(chunk, encoding, callback) {
        const value = String(chunk);
        if (value.includes(label) || value === ": " || value.includes("\n") || value.includes("\r")) {
          return originalWrite.call(this, chunk, encoding, callback);
        }
        return originalWrite.call(this, "*".repeat(value.length), encoding, callback);
      };
      const answer = await rl.question(`${label}: `);
      return answer.trim();
    } finally {
      stdout.write = originalWrite;
      rl.close();
    }
  });
}

async function pauseWithOutput(title, output) {
  clear();
  console.log(section(title));
  console.log("");
  console.log(limitOutput(output));
  await pause("\n按回车返回。");
}

async function pause(message) {
  return withCookedInput(async () => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      await rl.question(message);
    } finally {
      rl.close();
    }
  });
}

async function withCookedInput(callback) {
  stdin.setRawMode(false);
  showCursor();
  try {
    return await callback();
  } finally {
    hideCursor();
    stdin.setRawMode(true);
    stdin.resume();
  }
}

function splitFiles(value) {
  return value
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);
}

function isAffirmative(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes" || normalized === "是" || normalized === "启用";
}

function maskKey(value) {
  if (!value) {
    return "";
  }
  if (value.length <= 10) {
    return `${value.slice(0, 3)}...`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function defaultOptions() {
  return {
    stream: true,
    maxFiles: 400,
    maxBytes: 60_000
  };
}

function limitOutput(value) {
  const text = String(value || "");
  const max = 20_000;
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n[输出已截断]`;
}

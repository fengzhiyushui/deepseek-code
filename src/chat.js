import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { buildProjectContext } from "./context.js";
import { askDeepSeek } from "./provider.js";
import { section } from "./theme.js";

const CHAT_HISTORY_LIMIT = 30;

export async function chatCommand({ root, prompt, options }) {
  const config = await loadConfig(root);
  const history = options.reset ? [] : await loadChatHistory(root);
  const context = await buildProjectContext(root, {
    maxFiles: options.maxFiles,
    maxBytes: options.maxBytes
  });

  if (prompt) {
    const answer = await sendChatMessage({ root, config, context, history, prompt, stream: options.stream });
    return answer.content;
  }

  return runChatRepl({ root, config, context, history, stream: options.stream });
}

export async function sendChatMessage({ root, config, context, history, prompt, stream }) {
  const messages = [
    {
      role: "system",
      content: chatSystemPrompt()
    },
    {
      role: "user",
      content: [
        "Project context for this chat session:",
        context.indexText
      ].join("\n")
    },
    ...history.slice(-CHAT_HISTORY_LIMIT),
    {
      role: "user",
      content: prompt
    }
  ];

  const result = await askDeepSeek(config, messages, { stream });
  const nextHistory = [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: result.content }
  ].slice(-CHAT_HISTORY_LIMIT);
  await saveChatHistory(root, nextHistory);
  return result;
}

export async function loadChatHistory(root) {
  const target = chatHistoryPath(root);
  try {
    const payload = JSON.parse(await fs.readFile(target, "utf8"));
    return Array.isArray(payload.messages) ? payload.messages : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function clearChatHistory(root) {
  await saveChatHistory(root, []);
}

async function runChatRepl({ root, config, context, history, stream }) {
  console.log(section("连续对话"));
  console.log("输入 /exit 退出，/clear 清空上下文，/history 查看轮数。");
  console.log("");

  const rl = createInterface({ input: stdin, output: stdout });
  let currentHistory = history;
  try {
    while (true) {
      const prompt = (await rl.question("你 > ")).trim();
      if (!prompt) {
        continue;
      }
      if (prompt === "/exit" || prompt === "/quit") {
        return "已退出连续对话。";
      }
      if (prompt === "/clear") {
        currentHistory = [];
        await clearChatHistory(root);
        console.log("已清空对话上下文。");
        continue;
      }
      if (prompt === "/history") {
        console.log(`当前保留 ${currentHistory.length} 条消息。`);
        continue;
      }

      process.stdout.write("DeepSeek > ");
      const result = await sendChatMessage({
        root,
        config,
        context,
        history: currentHistory,
        prompt,
        stream
      });
      if (!stream) {
        console.log(result.content);
      }
      console.log("");
      currentHistory = await loadChatHistory(root);
    }
  } finally {
    rl.close();
  }
}

function saveChatHistory(root, messages) {
  const target = chatHistoryPath(root);
  return fs.mkdir(path.dirname(target), { recursive: true })
    .then(() => fs.writeFile(target, `${JSON.stringify({ messages }, null, 2)}\n`, "utf8"));
}

function chatHistoryPath(root) {
  return path.join(root, ".deepseek-code", "chat.json");
}

function chatSystemPrompt() {
  return [
    "You are DeepSeek Code, a local coding assistant in a persistent chat session.",
    "Answer in the user's language.",
    "Use the project context when relevant.",
    "If the task requires editing files, suggest the exact edit command and files to pass."
  ].join("\n");
}

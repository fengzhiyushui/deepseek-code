import { loadConfig } from "./config.js";
import { askDeepSeek } from "./provider.js";
import { buildProjectContext, readTextFile } from "./context.js";
import { captureChangePlan, finalizeChange } from "./changes.js";
import { applyUnifiedDiff, extractUnifiedDiff, summarizeDiff } from "./patch.js";
import { confirm, printBox, writeSessionLog } from "./ui.js";

export async function askCommand({ root, prompt, options }) {
  const config = await loadConfig(root);
  const project = await buildProjectContext(root, {
    maxFiles: options.maxFiles,
    maxBytes: options.maxBytes
  });

  const messages = [
    {
      role: "system",
      content: baseSystemPrompt()
    },
    {
      role: "user",
      content: [
        "You are answering a question about this local project.",
        "Project file index:",
        project.indexText,
        "",
        "User request:",
        prompt
      ].join("\n")
    }
  ];

  const result = await askDeepSeek(config, messages, { stream: options.stream });
  await writeSessionLog(root, "ask", { prompt, response: result.content, usage: result.usage });
  return options.stream ? "" : result.content;
}

export async function editCommand({ root, prompt, options }) {
  const config = await loadConfig(root);
  const project = await buildProjectContext(root, {
    maxFiles: options.maxFiles,
    maxBytes: options.maxBytes
  });

  const selectedFiles = await loadRequestedFiles(root, options.files);
  const messages = [
    {
      role: "system",
      content: editSystemPrompt()
    },
    {
      role: "user",
      content: [
        "Project file index:",
        project.indexText,
        "",
        selectedFiles.length ? "User-selected file contents:" : "No files were explicitly selected.",
        selectedFiles.map((file) => formatFileForPrompt(file.path, file.content)).join("\n\n"),
        "",
        "User change request:",
        prompt,
        "",
        "Return one unified diff only. Do not include prose outside the diff."
      ].join("\n")
    }
  ];

  const result = await askDeepSeek(config, messages, { stream: options.stream });
  const diff = extractUnifiedDiff(result.content);
  if (!diff) {
    await writeSessionLog(root, "edit:no-diff", { prompt, response: result.content });
    throw new Error("模型没有返回 unified diff。请尝试用 --file 指定要修改的文件。");
  }

  const summary = summarizeDiff(diff);
  printBox("拟应用补丁", diff);
  if (summary.length) {
    console.log("\n涉及文件：");
    for (const item of summary) {
      console.log(`  ${translateStatus(item.status).padEnd(8)} ${item.path}`);
    }
  }

  if (options.dryRun) {
    await writeSessionLog(root, "edit:dry-run", { prompt, diff, usage: result.usage });
    return "仅预览补丁，没有修改文件。";
  }

  const ok = options.yes || await confirm("是否应用这个补丁？");
  if (!ok) {
    await writeSessionLog(root, "edit:cancelled", { prompt, diff });
    return "已取消，没有修改文件。";
  }

  const changePlan = await captureChangePlan(root, diff, prompt);
  const applied = await applyUnifiedDiff(diff, root);
  const change = await finalizeChange(root, changePlan);
  await writeSessionLog(root, "edit:applied", { prompt, diff, applied, changeId: change.id, usage: result.usage });
  return [
    `已应用补丁，修改 ${applied.changedFiles.length} 个文件。`,
    `变更 ID：${change.id}`,
    "可运行 deepseek-code changes show latest 查看详情，或 deepseek-code rollback latest 回退。"
  ].join("\n");
}

async function loadRequestedFiles(root, files) {
  const result = [];
  for (const file of files) {
    result.push({
      path: file,
      content: await readTextFile(root, file, 200_000)
    });
  }
  return result;
}

function formatFileForPrompt(path, content) {
  return [`--- ${path}`, content].join("\n");
}

function baseSystemPrompt() {
  return [
    "You are DeepSeek Code, a local coding assistant.",
    "Be concise, accurate, and grounded in the provided project context.",
    "When you are unsure, say what extra file or command would be needed."
  ].join("\n");
}

function editSystemPrompt() {
  return [
    "You are DeepSeek Code, a local coding agent that edits source code.",
    "Return a valid unified diff and nothing else.",
    "Use paths relative to the project root.",
    "Do not delete unrelated code.",
    "Keep edits focused on the user request.",
    "If more context is required, return no diff and explain the missing files in one sentence."
  ].join("\n");
}

function translateStatus(status) {
  if (status === "create") {
    return "新建";
  }
  if (status === "delete") {
    return "删除";
  }
  return "修改";
}

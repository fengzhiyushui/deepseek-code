// src/tui.js — TUI 薄入口。真正的实现在 src/apps/tui/tui-app.js(D-5 重设计)。
import { stdin, stdout } from "node:process";
import { createTuiApp } from "./apps/tui/tui-app.js";

export async function runTui(root, kernel = null) {
  if (!stdin.isTTY || !stdout.isTTY) {
    // 启动前置错误,早于语言偏好加载;文案与旧版保持一致。
    throw new Error("TUI 需要在交互式终端中运行。");
  }
  const app = createTuiApp({ root, kernel, input: stdin, output: stdout });
  await app.run();
}

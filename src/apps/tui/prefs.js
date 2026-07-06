// src/apps/tui/prefs.js — TUI 本地偏好(语言等),原子小文件。
import fsp from "node:fs/promises";
import path from "node:path";

function fileOf(root) { return path.join(root, ".deepseek-code", "tui-prefs.json"); }

export async function loadTuiPrefs(root) {
  try {
    const raw = JSON.parse(await fsp.readFile(fileOf(root), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export async function saveTuiPrefs(root, prefs) {
  const file = fileOf(root);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(prefs, null, 2), "utf8");
  await fsp.rename(tmp, file);
}

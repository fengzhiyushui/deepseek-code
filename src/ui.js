import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function confirm(question) {
  if (!input.isTTY) {
    return false;
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/是/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes" || normalized === "是" || normalized === "确认";
  } finally {
    rl.close();
  }
}

export function printBox(title, content) {
  console.log(`\n== ${title} ==`);
  console.log(content);
}

export async function writeSessionLog(root, type, data) {
  const dir = path.join(root, ".deepseek-code");
  await fs.mkdir(dir, { recursive: true });
  const entry = {
    time: new Date().toISOString(),
    type,
    ...data
  };
  await fs.appendFile(path.join(dir, "sessions.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
}

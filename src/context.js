import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  ".git",
  ".deepseek-code",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  "__pycache__"
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);

export async function buildProjectContext(root, options = {}) {
  const maxFiles = options.maxFiles ?? 400;
  const maxBytes = options.maxBytes ?? 60_000;
  const files = await listProjectFiles(root, { maxFiles });
  const important = rankImportantFiles(files).slice(0, 30);
  const snippets = [];
  let usedBytes = 0;

  for (const file of important) {
    if (!isLikelyText(file)) {
      continue;
    }
    const content = await readTextFile(root, file, 16_000).catch(() => "");
    if (!content) {
      continue;
    }
    const piece = [`--- ${file}`, content.slice(0, 4000)].join("\n");
    usedBytes += Buffer.byteLength(piece, "utf8");
    if (usedBytes > maxBytes) {
      break;
    }
    snippets.push(piece);
  }

  return {
    files,
    indexText: [
      `项目根目录：${root}`,
      `已索引文件数：${files.length}`,
      "",
      files.slice(0, maxFiles).join("\n"),
      "",
      snippets.length ? "重要文件片段：" : "",
      snippets.join("\n\n")
    ].join("\n")
  };
}

export async function listProjectFiles(root, options = {}) {
  const maxFiles = options.maxFiles ?? 1000;
  const result = [];

  async function walk(current) {
    if (result.length >= maxFiles) {
      return;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (result.length >= maxFiles) {
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".gitignore") {
        if (entry.isDirectory() || entry.name !== ".gitignore") {
          continue;
        }
      }

      const absolute = path.join(current, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          await walk(absolute);
        }
      } else if (entry.isFile()) {
        result.push(relative);
      }
    }
  }

  await walk(root);
  return result;
}

export async function readTextFile(root, relativePath, maxBytes = 200_000) {
  const target = resolveInsideRoot(root, relativePath);
  const stat = await fs.stat(target);
  if (stat.size > maxBytes) {
    throw new Error(`${relativePath} 文件过大（${stat.size} 字节）。`);
  }

  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) {
    throw new Error(`${relativePath} 看起来是二进制文件。`);
  }
  return buffer.toString("utf8");
}

export function resolveInsideRoot(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`路径必须是相对路径：${relativePath}`);
  }

  const target = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`路径超出了项目根目录：${relativePath}`);
  }
  return target;
}

function rankImportantFiles(files) {
  const priority = [
    "README.md",
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    ".gitignore"
  ];

  return [...files].sort((a, b) => {
    const pa = priority.indexOf(a);
    const pb = priority.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
    }
    return a.localeCompare(b);
  });
}

function isLikelyText(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || path.basename(file).includes(".");
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

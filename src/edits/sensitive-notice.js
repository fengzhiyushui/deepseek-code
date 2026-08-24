import { contextSkipReason } from "../context/workspace-indexer.js";

// #9.3 敏感文件风险提醒 —— 纯判定层,无 IO。
//
// 判定复用 context 扫描的忽略集(`contextSkipReason`),但**只取含密钥的两类**。
// `contextSkipReason` 还会为 `.git`/`node_modules`/`dist`/`build`(ignored-directory)
// 与 `.vscode`/`.claude`(hidden-tool-dir)返回非 null —— 那些只是「不进上下文索引」,
// 不是密钥文件。整个复用会让红色提醒在改 `dist/` 时也弹,沦为噪音;
// 提醒一旦成噪音就等于没有,所以在这里收窄。
const SENSITIVE_REASONS = new Set(["secret-file", "credential-file"]);

export function sensitiveReasonFor(inputPath) {
  const reason = contextSkipReason(inputPath);
  return SENSITIVE_REASONS.has(reason) ? reason : null;
}

/**
 * 组装提醒载荷。
 * @param {string[]} paths 本次 diff 涉及的工作区相对路径
 * @returns {{ paths: Array<{path:string, reason:string}>, recordDir: string } | null}
 *   命中时返回载荷,未命中返回 null(调用方据此决定是否提醒)。
 */
export function buildSensitiveNotice(paths = []) {
  const hits = [];
  for (const inputPath of paths) {
    const reason = sensitiveReasonFor(inputPath);
    if (reason) hits.push({ path: inputPath, reason });
  }
  if (!hits.length) return null;
  return { paths: hits, recordDir: ".deepseek-code/changes" };
}

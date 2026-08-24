// #9.3 敏感文件风险提醒 —— 三端共享展示契约。
//
// 与 `event-contract.js` 同一模式:本模块是「提醒载荷 → 展示语义」的唯一映射源,
// CLI / TUI / GUI 三端渲染器只读描述符字段,各自决定措辞、颜色与 i18n。
//
// ── 策略(维护者 2026-08-09 定,勿在渲染层各自加判断)──
//
// 1. **独立于所有权限档位之外。** 权限矩阵管的是「agent 能不能做这个动作」;
//    本提醒告知的是「这个动作会在 .deepseek-code/changes/ 留下一份你看不见的
//    密钥副本」—— 属副作用告知,不是动作授权。
//
// 2. **所有档位一律提问,没有任何档位能跳过。** 包括 full-auto —— 这与既有
//    权限矩阵一致:full-auto 的 `read_secret` 与 `execute_dangerous` 本来就是
//    "ask",full-auto 从来不是「无人值守免打扰」档。若在此处按档位放行,
//    auto / full-auto 会一键跳过,恰好绕过最该提醒的场景。
//
// 3. **不缓存选择。** 走审批缓存就等于把「独立于权限之外」又拉回权限体系;
//    这类告知的价值就在于每次都让人看见。
//
// 4. **红色显著标注,不复用普通审批卡片的样式** —— 它不是审批。

export const SENSITIVE_NOTICE_SEVERITY = "danger";

const REASON_KEYS = Object.freeze({
  "secret-file": "sensitive.reason.secret",
  "credential-file": "sensitive.reason.credential"
});

/**
 * 把 editService 的提醒载荷归一为展示描述符。
 * 纯函数,任意输入不抛错。
 *
 * @param {{ paths: Array<{path:string, reason:string}>, recordDir?: string }} notice
 * @returns {{
 *   kind: "sensitive-file-write",
 *   severity: "danger",
 *   paths: Array<{ path: string, reason: string, reasonKey: string }>,
 *   recordDir: string,
 *   count: number
 * } | null}
 */
export function describeSensitiveNotice(notice) {
  const paths = Array.isArray(notice?.paths) ? notice.paths : [];
  if (!paths.length) return null;
  return {
    kind: "sensitive-file-write",
    severity: SENSITIVE_NOTICE_SEVERITY,
    paths: paths.map((item) => ({
      path: String(item?.path ?? ""),
      reason: String(item?.reason ?? ""),
      reasonKey: REASON_KEYS[item?.reason] || "sensitive.reason.other"
    })),
    recordDir: String(notice?.recordDir || ".deepseek-code/changes"),
    count: paths.length
  };
}

/**
 * 组装 onSensitiveNotice 回调。三端把各自的「提问」实现传进来即可,
 * 策略(一律问、不缓存)统一在这里,渲染层不再各自判断。
 *
 * @param {(descriptor) => Promise<boolean>} ask 交互式提问,返回是否允许
 * @param {(descriptor) => void} [onDeclined] 拒绝时的上报钩子(可选)
 */
export function createSensitiveNoticeHandler(ask, onDeclined = () => {}) {
  if (typeof ask !== "function") throw new Error("ask is required");
  return async (notice) => {
    const descriptor = describeSensitiveNotice(notice);
    if (!descriptor) return true; // 无命中不该走到这里,保守放行避免误拦
    const allowed = await ask(descriptor);
    if (allowed === true) return true;
    onDeclined(descriptor);
    return false;
  };
}

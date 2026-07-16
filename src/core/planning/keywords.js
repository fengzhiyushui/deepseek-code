// src/core/planning/keywords.js — 意图分类与复杂度路由共享的中英关键词表。
// 唯一来源:classifier.js(task_type 判定)与 task-router.js(多智能体复杂度标记)
// 都从这里取词,保证「同仓两套语言假设」一致——中文请求不再一律落 general。

// edit:请求改动代码。中英对照。
export const EDIT_KEYWORDS = [
  "fix", "change", "modify", "edit", "delete", "remove", "add", "create",
  "write", "update", "refactor", "implement", "rename", "move", "replace",
  // 中文
  "修复", "修改", "改动", "更改", "编辑", "删除", "移除", "添加", "新增", "创建",
  "编写", "写入", "更新", "重构", "实现", "重命名", "替换", "调整代码"
];

// diagnostic:排查/调查类。中英对照。
export const DIAGNOSTIC_KEYWORDS = [
  "debug", "diagnose", "analyze", "investigate", "inspect", "check",
  // 中文
  "调试", "诊断", "排查", "调查", "分析", "检查", "排查问题"
];

// query:提问/解释/检索。中英对照。
export const QUERY_KEYWORDS = [
  "what", "how", "why", "explain", "describe", "show", "list", "who",
  "where", "when", "can", "could", "tell", "find", "get",
  // 中文
  "什么", "怎么", "怎样", "如何", "为什么", "为何", "解释", "说明", "描述",
  "展示", "列出", "谁", "哪里", "何时", "能否", "可以吗", "告诉", "查找", "获取"
];

// 中文疑问语气词只在句尾判定,避免「呢/么」出现在普通陈述中时误分类。
export const CN_QUESTION_HINT_PATTERN = /(?:吗|呢|么)\s*[?？]?$/;

// 复杂度路由与意图分类共用同一文件维护中英词表,避免两套语言假设漂移。
export const COMPLEXITY_STRONG_MARKERS = [
  "重构整个", "迁移", "跨多个文件", "跨文件",
  "refactor the entire", "migrate", "across multiple"
];
export const COMPLEXITY_WEAK_MARKERS = [
  "这几个", "这些", "分别", "各自", "逐个", "逐一",
  "for each", "each of"
];
// 顺序保持 v1.0.0 task-router 的历史顺序,避免 disabled-path signals 观测回归。
export const COMPLEXITY_MARKERS = [
  "这几个", "这些", "分别", "各自", "逐个", "逐一",
  "重构整个", "迁移", "跨多个文件", "跨文件",
  "for each", "each of", "across multiple", "refactor the entire", "migrate"
];

// 全角问号也视作提问结尾。
export function endsWithQuestionMark(text) {
  return text.endsWith("?") || text.endsWith("？");
}

// 把关键词列表编译成一条不区分大小写的、带词边界的正则。
// 英文用 \b 词边界;中文直接子串匹配(中文无词边界,且词本身较长不易误命中)。
export function buildKeywordPattern(keywords) {
  const parts = keywords.map((kw) => {
    return /[A-Za-z]/.test(kw) ? `\\b${escapeRegex(kw)}\\b` : escapeRegex(kw);
  });
  return new RegExp(parts.join("|"), "i");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const EDIT_PATTERN = buildKeywordPattern(EDIT_KEYWORDS);
export const DIAGNOSTIC_PATTERN = buildKeywordPattern(DIAGNOSTIC_KEYWORDS);
export const QUERY_PATTERN = buildKeywordPattern(QUERY_KEYWORDS);

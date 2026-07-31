// gui/src/state/metrics-view.js — 对话框状态行的指标推导(纯函数,node:test 覆盖)。
// 设计稿 v4 把「比例型指标」做成 5 形态(文字/数值/进度条/点阵/关闭),此处只算数值与色阶,
// 具体 DOM 交给 MetricsLine。数据源是 kernel 的 usage 快照,没有的指标一律不出现(不编造)。

export const CONTEXT_WINDOW = 128000; // 上下文窗口上限(与 deepseek 模型档一致)

export function formatPercent(ratio, decimals = 0) {
  const pct = Math.max(0, Math.min(1, Number(ratio) || 0)) * 100;
  return `${pct.toFixed(Math.max(0, Math.min(4, decimals)))}%`;
}

// bigUnits=true → 34.2k / 1.2M;false → 原始数字。
export function formatCount(value, bigUnits = true) {
  const n = Math.max(0, Number(value) || 0);
  if (!bigUnits) return String(n);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function cacheRatio(usage) {
  const u = usage || {};
  if (typeof u.cache_hit_rate === "number") return Math.max(0, Math.min(1, u.cache_hit_rate));
  const hits = Number(u.cache_hit_tokens) || 0;
  const misses = Number(u.cache_miss_tokens) || 0;
  return hits + misses > 0 ? hits / (hits + misses) : 0;
}

export function totalTokens(usage) {
  const u = usage || {};
  if (typeof u.total_tokens === "number") return u.total_tokens;
  return (Number(u.total_prompt_tokens) || 0) + (Number(u.total_completion_tokens) || 0);
}

// 比例型指标段。每段:{ key, ratio, text, num:{v,u}, tone }。
// tone:accent(默认)/ok(越高越好)/warn(超过阈值的上下文用量)。
export function metricSegments(usage, display) {
  const show = (display && display.show) || {};
  const fmt = (display && display.format) || {};
  const decimals = Number.isInteger(fmt.percentDecimals) ? fmt.percentDecimals : 0;
  const bigUnits = fmt.bigUnits !== false;
  const warnAt = typeof fmt.contextWarnRatio === "number" ? fmt.contextWarnRatio : 0.8;
  const segments = [];

  if (show.context !== false) {
    const tokens = totalTokens(usage);
    const ratio = Math.min(1, tokens / CONTEXT_WINDOW);
    segments.push({
      key: "context",
      ratio,
      text: `${formatCount(tokens, bigUnits)}/${formatCount(CONTEXT_WINDOW, bigUnits)}`,
      num: { v: formatCount(tokens, bigUnits), u: `/${formatCount(CONTEXT_WINDOW, bigUnits)}` },
      percent: formatPercent(ratio, decimals),
      tone: ratio >= warnAt ? "warn" : "accent"
    });
  }

  if (show.cacheHit !== false) {
    const ratio = cacheRatio(usage);
    segments.push({
      key: "cacheHit",
      ratio,
      text: formatPercent(ratio, decimals),
      num: { v: formatPercent(ratio, decimals).replace("%", ""), u: "%" },
      percent: formatPercent(ratio, decimals),
      tone: "ok"
    });
  }

  // 检索命中率:kernel 暂未上报,没有数据就不显示这一段(而不是显示 0)。
  const retrieval = usage && usage.retrieval;
  if (show.retrievalHit !== false && retrieval && Number(retrieval.total) > 0) {
    const ratio = Math.min(1, Number(retrieval.hit) / Number(retrieval.total));
    segments.push({
      key: "retrievalHit",
      ratio,
      text: `${retrieval.hit}/${retrieval.total}`,
      num: { v: String(retrieval.hit), u: `/${retrieval.total}` },
      percent: formatPercent(ratio, decimals),
      tone: "accent"
    });
  }

  return segments;
}

// 点阵形态:按格数把比例离散化。
export function dotCells(ratio, count) {
  const total = Math.max(4, Math.min(24, Number(count) || 10));
  const filled = Math.max(0, Math.min(total, Math.round((Number(ratio) || 0) * total)));
  return { total, filled };
}

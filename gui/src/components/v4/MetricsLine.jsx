import React from "react";

// v1.4.0 对话框指标行(.cz-meta)。比例型指标(上下文用量/缓存命中/检索命中)按
// statusDisplay.form 渲染 5 形态;状态型标签(分支/模型/主题/语言)恒为文字。
// form: text | num | bar | dots | off
export default function MetricsLine({ t, display, metrics = {} }) {
  const form = display?.form || "bar";
  if (form === "off") return null;

  const fmt = display?.format || {};
  const percent = (v) => `${(v * 100).toFixed(fmt.percentDecimals ?? 0)}%`;
  const tokens = Number(metrics.tokens) || 0;
  const contextRatio = tokens / 128000; // 上下文窗口 128k
  const cacheRate = Number(metrics.cacheRate) || 0;
  const retrieval = metrics.retrieval ?? null; // {hit, total}
  const retrievalRatio = retrieval && retrieval.total ? retrieval.hit / retrieval.total : null;

  const show = display?.show || {};
  const segs = [];
  if (show.context !== false) segs.push({ key: "ctx", label: t("metrics.context"), ratio: Math.min(1, contextRatio), text: `${(tokens / 1000).toFixed(1)}k/128k` });
  if (show.cacheHit !== false) segs.push({ key: "cache", label: t("metrics.cacheHit"), ratio: cacheRate, text: percent(cacheRate) });
  if (show.retrievalHit !== false && retrievalRatio != null) segs.push({ key: "retrieval", label: t("metrics.retrievalHit"), ratio: retrievalRatio, text: `${retrieval.hit}/${retrieval.total}` });

  const bar = (seg, warn) => (
    <span className={`m-bar ${warn ? "warn" : ""}`}><span style={{ width: `${Math.round(seg.ratio * 100)}%` }} /></span>
  );
  const dots = (seg, warn) => {
    const count = Math.max(4, Math.min(24, fmt.dotsCount ?? 10));
    const filled = Math.round(seg.ratio * count);
    return (
      <span className={`m-dots ${warn ? "warn" : ""}`}>
        {Array.from({ length: count }, (_, i) => <i key={i} className={i < filled ? "on" : ""} />)}
      </span>
    );
  };

  return (
    <div className="cz-meta">
      {segs.map((seg) => {
        const warn = seg.ratio >= (fmt.contextWarnRatio ?? 0.8);
        return (
          <span key={seg.key} className={`m-seg ${warn ? "warn" : ""}`}>
            <span className="m-lbl">{seg.label}</span>
            {form === "text" && <span className="m-val">{seg.text}</span>}
            {form === "num" && <span className="m-val">{seg.label} {seg.text}</span>}
            {form === "bar" && bar(seg, warn)}
            {form === "dots" && dots(seg, warn)}
          </span>
        );
      })}
    </div>
  );
}

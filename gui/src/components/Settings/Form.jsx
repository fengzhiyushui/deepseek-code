import React from "react";

// 设置页共用的表单原语(设计稿 v4 的 .f-row / .sw)。
// 单独成文件是为了避免 Settings.jsx ↔ 各面板的循环引用。

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={`sw ${on ? "on" : ""}`} role="switch" aria-checked={Boolean(on)}
      aria-label={label} onClick={() => onChange(!on)} />
  );
}

export function Row({ title, desc, children }) {
  return (
    <div className="f-row">
      <div className="fl">
        <div className="ft">{title}</div>
        {desc && <div className="fd">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

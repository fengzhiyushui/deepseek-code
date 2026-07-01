import React from "react";

// Explicit placeholder wrapper (§6.3): visually + a11y marked so it is never mistaken
// for live data. The .placeholder CSS adds a "示例 · Placeholder" badge.
export default function Placeholder({ label = "示例数据(未接入)", children }) {
  return (
    <div className="placeholder" role="note" aria-label={label}>
      <div className="ph-body">{children}</div>
    </div>
  );
}

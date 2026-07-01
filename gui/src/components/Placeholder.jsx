import React from "react";

// Explicit placeholder (§6.3): visually + a11y marked; never mistaken for live data.
export default function Placeholder({ badge, label, children }) {
  return (
    <div className="placeholder" role="note" aria-label={label}>
      <span className="ph-badge">{badge}</span>
      <div className="ph-body">{children}</div>
    </div>
  );
}

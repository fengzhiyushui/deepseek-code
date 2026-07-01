import React from "react";

// Hand-drawn inline SVG icon set (no icon library). name-keyed for compactness.
const P = {
  logo: <path d="M4 7l8-4 8 4v10l-8 4-8-4V7z M12 3v18 M4 7l8 4 8-4" stroke="currentColor" strokeWidth="1.4" fill="none" />,
  files: <path d="M6 3h9l3 3v15H6V3zm8 1v3h3" fill="currentColor" />,
  search: <g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.5-4.5" /></g>,
  scm: <g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="9" r="2.5" /><path d="M6 8.5v7M8.3 7.2C11 8 13 8.5 15.6 8.9" /></g>,
  run: <path d="M8 5v14l11-7z" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  ext: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4z" fill="currentColor" />,
  agent: <g fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16h6" /><circle cx="12" cy="4" r="1.3" fill="currentColor" /></g>,
  settings: <g fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></g>,
  moon: <path d="M20 14A8 8 0 019.5 3.5 8 8 0 1020 14z" fill="none" stroke="currentColor" strokeWidth="1.7" />,
  sun: <g fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2" /></g>,
  branch: <g fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="7" r="2.5" /><path d="M6 8.5v7M8.3 7C11 8 14 8 15.6 8" /></g>,
  error: <g fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></g>,
  warn: <g fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></g>,
  bell: <path d="M18 8A6 6 0 006 8c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 01-3.4 0" fill="none" stroke="currentColor" strokeWidth="1.7" />,
  plan: <path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" strokeWidth="2" />,
  edit: <path d="M6 3h9l3 3v15H6z" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  check: <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.9" />,
  globe: <g fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" /></g>
};

export default function Icon({ name, size = 22, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
      {P[name] || null}
    </svg>
  );
}

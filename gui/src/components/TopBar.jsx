import React from "react";
import { Moon, Sun } from "lucide-react";
import { statusSummary, trafficTone, trafficLabel, themeLabel } from "../state/workbench-state.js";

export default function TopBar({ state, onToggleTheme }) {
  const tone = trafficTone(state);
  const summary = statusSummary(state);
  const isDark = state.theme !== "day";
  return (
    <header className="topbar" role="banner">
      <span className="brand">DeepSeek Code</span>
      <span className="seg ellipsis" aria-label={`active branch ${summary.branch}`} title={summary.branch}>
        ⑂ {summary.branch}
      </span>
      <span className="spacer" />
      <span aria-live="polite" aria-label={`status ${trafficLabel(tone, state)}`}>
        <span className={`traffic ${tone}`} aria-hidden="true" /> {trafficLabel(tone, state)}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={`switch theme (currently ${themeLabel(state.theme)})`}
        onClick={onToggleTheme}
        style={{ background: "transparent", border: "none", color: "var(--ide-text)", cursor: "pointer", display: "grid", placeItems: "center" }}
      >
        {isDark ? <Moon size={16} /> : <Sun size={16} />}
      </button>
    </header>
  );
}

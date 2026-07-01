import React from "react";
import Icon from "./Icons.jsx";

const ITEMS = [
  { key: "explorer", icon: "files" },
  { key: "search", icon: "search" },
  { key: "scm", icon: "scm", badge: "3" },
  { key: "run", icon: "run" },
  { key: "ext", icon: "ext" },
  { key: "agent", icon: "agent", agent: true }
];

export default function ActivityBar({ t, active, onSelect }) {
  return (
    <nav className="activity" role="tablist" aria-label="activity bar" aria-orientation="vertical">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={active === it.key}
          aria-label={t("rail." + it.key)}
          className={`item ${it.agent ? "agent" : ""} ${active === it.key ? "active" : ""}`}
          onClick={() => onSelect(it.key)}
        >
          <Icon name={it.icon} size={it.agent ? 24 : 22} />
          {it.badge && <span className="badge">{it.badge}</span>}
        </button>
      ))}
      <div className="spacer" />
      <button
        type="button"
        className={`item ${active === "settings" ? "active" : ""}`}
        role="tab"
        aria-selected={active === "settings"}
        aria-label={t("rail.settings")}
        onClick={() => onSelect("settings")}
      >
        <Icon name="settings" size={22} />
      </button>
    </nav>
  );
}

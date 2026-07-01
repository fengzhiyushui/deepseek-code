import React from "react";
import { MessageSquare, Folder, GitBranch, Clock, Settings } from "lucide-react";

const MODES = [
  { key: "chat", icon: MessageSquare, label: "Chat" },
  { key: "context", icon: Folder, label: "Context" },
  { key: "branches", icon: GitBranch, label: "Branches" },
  { key: "timeline", icon: Clock, label: "Timeline" },
  { key: "settings", icon: Settings, label: "Settings" }
];

export default function ActivityRail({ railMode, onSelect }) {
  return (
    <nav className="panel rail" role="tablist" aria-label="activity rail" aria-orientation="vertical">
      {MODES.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={railMode === key}
          aria-label={label}
          onClick={() => onSelect(key)}
        >
          <Icon size={18} aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}

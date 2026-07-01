import React from "react";
import Icon from "./Icons.jsx";

const MENU = ["menu.file", "menu.edit", "menu.selection", "menu.view", "menu.go", "menu.run", "menu.agent", "menu.help"];

export default function TitleBar({ t, language, theme, title, onToggleTheme, onToggleLang }) {
  const dark = theme !== "day";
  return (
    <header className="titlebar" role="banner">
      <div className="logo" style={{ color: "var(--accent)" }}><Icon name="logo" size={16} /></div>
      <nav className="menu" aria-label="menu">
        {MENU.map((k) => <button key={k} type="button">{t(k)}</button>)}
      </nav>
      <div className="title">{title}</div>
      <div className="actions">
        <button type="button" className="ib lang" aria-label={t("toggle.lang")} onClick={onToggleLang}>
          {language === "zh" ? "中" : "EN"}
        </button>
        <button type="button" className="ib" aria-label={t("toggle.theme")} onClick={onToggleTheme}>
          <Icon name={dark ? "moon" : "sun"} size={15} />
        </button>
      </div>
      <div className="winctl">
        <button type="button" aria-label="minimize" onClick={() => window.deepseek?.minimize?.()}>&#9472;</button>
        <button type="button" aria-label="maximize" onClick={() => window.deepseek?.maximizeToggle?.()}>&#9723;</button>
        <button type="button" className="close" aria-label="close" onClick={() => window.deepseek?.closeWindow?.()}>&#10005;</button>
      </div>
    </header>
  );
}

import React from "react";
import { GUI_THEMES } from "../../state/themes.js";

// 设置 › 外观:10 套主题网格(每卡用 theme 属性预览该主题真实 token 色)。
export default function Appearance({ t, state, kernel, dispatch }) {
  const setTheme = (id) => {
    dispatch({ type: "theme_changed", theme: id });
    kernel.setPreferences({ theme: id });
  };
  return (
    <div className="set-group">
      <h3>{t("settings.appearance.themes")}</h3>
      <div className="theme-grid">
        {GUI_THEMES.map((th) => (
          <button key={th.id} type="button" theme={th.id}
            className={`theme-card ${state.theme === th.id ? "on" : ""}`}
            aria-pressed={state.theme === th.id} onClick={() => setTheme(th.id)}>
            <span className="sw"><i /><i /><i /></span>
            <span className="nm">{th.name}</span>
            <span className="f">{th.family}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

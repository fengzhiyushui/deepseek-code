import React from "react";
import { STATUS_FORMS, STATUS_POSITIONS, STATUS_TOGGLES } from "../../state/status-display.js";

// 设置 › 状态显示:4 组 22 项全中文(形态/位置/显示哪些/数值格式),改动即写偏好。
export default function StatusDisplayPanel({ t, state, kernel, dispatch }) {
  const d = state.statusDisplay || { show: {}, format: {} };
  const apply = (patch) => {
    const next = {
      ...d,
      ...patch,
      show: { ...(d.show || {}), ...(patch.show || {}) },
      format: { ...(d.format || {}), ...(patch.format || {}) }
    };
    dispatch({ type: "status_display_changed", display: next });
    kernel.setPreferences({ statusDisplay: next });
  };

  const formIcons = { text: "T", num: "123", bar: "▂▄▆", dots: "⬜⬛", off: "–" };
  const toggleLabel = {
    branch: "settings.sd.branch", checkpoint: "settings.sd.checkpoint", connection: "settings.sd.connection",
    context: "settings.sd.context", cacheHit: "settings.sd.cacheHit", retrievalHit: "settings.sd.retrievalHit",
    turnTime: "settings.sd.turnTime", turnChanges: "settings.sd.turnChanges", model: "settings.sd.model",
    theme: "settings.sd.theme", language: "settings.sd.language"
  };

  return (
    <div className="set-group">
      <h3>{t("settings.sd.form")}</h3>
      <div className="sd-form">
        {STATUS_FORMS.map((f) => (
          <button key={f} type="button" className={`sd-card ${d.form === f ? "on" : ""}`} onClick={() => apply({ form: f })}>
            <span className="ic">{formIcons[f]}</span><span>{t(`settings.sd.form.${f}`)}</span>
          </button>
        ))}
      </div>

      <h3>{t("settings.sd.position")}</h3>
      <div className="set-fields">
        <label className="field"><span>{t("settings.sd.positionLabel")}</span>
          <select className="select" value={d.position} onChange={(e) => apply({ position: e.target.value })}>
            {STATUS_POSITIONS.map((p) => <option key={p} value={p}>{t(`settings.sd.pos.${p}`)}</option>)}
          </select></label>
        <label className="field checkbox"><input type="checkbox" checked={Boolean(d.fadeIdle)} onChange={(e) => apply({ fadeIdle: e.target.checked })} /><span>{t("settings.sd.fadeIdle")}</span></label>
        <label className="field checkbox"><input type="checkbox" checked={Boolean(d.compact)} onChange={(e) => apply({ compact: e.target.checked })} /><span>{t("settings.sd.compact")}</span></label>
      </div>

      <h3>{t("settings.sd.show")}</h3>
      <div className="set-fields sd-toggles">
        {STATUS_TOGGLES.map((key) => (
          <label key={key} className="field checkbox">
            <input type="checkbox" checked={Boolean(d.show[key])} onChange={(e) => apply({ show: { [key]: e.target.checked } })} />
            <span>{t(toggleLabel[key])}</span>
          </label>
        ))}
      </div>

      <h3>{t("settings.sd.format")}</h3>
      <div className="set-fields">
        <label className="field"><span>{t("settings.sd.percentDecimals")}</span>
          <input type="number" min="0" max="4" value={d.format.percentDecimals ?? 0} onChange={(e) => apply({ format: { percentDecimals: Number(e.target.value) } })} /></label>
        <label className="field checkbox"><input type="checkbox" checked={Boolean(d.format.bigUnits)} onChange={(e) => apply({ format: { bigUnits: e.target.checked } })} /><span>{t("settings.sd.bigUnits")}</span></label>
        <label className="field"><span>{t("settings.sd.warnRatio")}</span>
          <input type="number" min="0" max="1" step="0.05" value={d.format.contextWarnRatio ?? 0.8} onChange={(e) => apply({ format: { contextWarnRatio: Number(e.target.value) } })} /></label>
        <label className="field"><span>{t("settings.sd.dotsCount")}</span>
          <input type="number" min="4" max="24" value={d.format.dotsCount ?? 10} onChange={(e) => apply({ format: { dotsCount: Number(e.target.value) } })} /></label>
      </div>
    </div>
  );
}

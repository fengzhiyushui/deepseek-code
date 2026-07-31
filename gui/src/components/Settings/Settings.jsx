import React, { useCallback, useEffect, useState } from "react";
import { SETTINGS_GROUPS, getByPath, applyFieldEdit, sanitizeConfigPatch } from "../../state/settings-schema.js";
import ModelAccess from "./ModelAccess.jsx";

function Field({ t, field, value, onChange }) {
  const label = t(field.labelKey);
  if (field.type === "bool") {
    return (
      <label className="field checkbox">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field, e.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  if (field.type === "enum") {
    return (
      <label className="field">
        <span>{label}</span>
        <select className="select" value={value ?? field.options[0]} onChange={(e) => onChange(field, e.target.value)}>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  // numeric / nullable — empty means "off/unlimited" for nullableInt
  return (
    <label className="field">
      <span>{label}{field.unit ? ` (${field.unit})` : ""}</span>
      <input type="number" value={value === null || value === undefined ? "" : value}
        placeholder={field.type === "nullableInt" ? t("settings.off") : ""}
        onChange={(e) => onChange(field, e.target.value)} />
    </label>
  );
}

function ConfigGroup({ t, group, draft, setDraft, onSave, dirty, saving }) {
  const onChange = (field, raw) => setDraft((d) => applyFieldEdit(d, field, raw));
  return (
    <div className="set-group">
      <div className="set-fields">
        {group.fields.map((f) => (
          <Field key={f.path} t={t} field={f} value={getByPath(draft, f.path)} onChange={onChange} />
        ))}
      </div>
      <div className="set-actions">
        <button type="button" className="btn accent" disabled={!dirty || saving} onClick={onSave}>{t("settings.save")}</button>
        {dirty && <span className="dim">{t("settings.unsaved")}</span>}
      </div>
    </div>
  );
}

function General({ t, state, kernel, dispatch }) {
  const setTheme = (theme) => { dispatch({ type: "theme_changed", theme }); kernel.setPreferences({ theme }); };
  const setLang = (language) => { dispatch({ type: "language_changed", language }); kernel.setPreferences({ language }); };
  return (
    <div className="set-group">
      <div className="set-fields">
        <label className="field"><span>{t("settings.theme")}</span>
          <select className="select" value={state.theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="night">{t("settings.theme.night")}</option>
            <option value="day">{t("settings.theme.day")}</option>
          </select></label>
        <label className="field"><span>{t("settings.language")}</span>
          <select className="select" value={state.language} onChange={(e) => setLang(e.target.value)}>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select></label>
      </div>
    </div>
  );
}

function About({ t, state, settings }) {
  const cfg = settings?.config || {};
  return (
    <div className="set-group about">
      <p><strong>Inkstone</strong></p>
      <p className="dim">{t("settings.about.model")}: {cfg.model || "—"}</p>
      <p className="dim">{t("settings.about.baseUrl")}: {cfg.baseUrl || "—"}</p>
      <p className="dim">{t("settings.about.key")}: {cfg.hasApiKey ? "✓" : "✗"}</p>
      <p className="dim">{t("settings.about.blurb")}</p>
    </div>
  );
}

export default function Settings({ t, state, kernel, dispatch }) {
  const [active, setActive] = useState("general");
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!kernel.available || !kernel.getSettings) { setError(t("settings.noBridge")); return; }
    try {
      const s = await kernel.getSettings();
      if (s && s.error) { setError(s.error); return; }
      setSettings(s || null);
      setDraft((s && s.config) || {});
      setError("");
    } catch (e) { setError(e.message); }
  }, [kernel, t]);

  useEffect(() => { reload(); }, [reload]);

  const group = SETTINGS_GROUPS.find((g) => g.id === active) || SETTINGS_GROUPS[0];
  const dirty = settings && JSON.stringify(draft) !== JSON.stringify(settings.config || {});

  const saveConfig = async () => {
    setSaving(true);
    try {
      const r = await kernel.setConfig(sanitizeConfigPatch(draft));
      if (r && r.error) setError(r.error);
      else await reload();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="settings" aria-label={t("rail.settings")}>
      <nav className="settings-nav" aria-label={t("rail.settings")}>
        <div className="settings-title">{t("rail.settings")}</div>
        {SETTINGS_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`snav-item ${active === g.id ? "active" : ""}`}
            aria-current={active === g.id} onClick={() => setActive(g.id)}>{t(g.labelKey)}</button>
        ))}
      </nav>
      <div className="settings-main">
        <h2>{t(group.labelKey)}</h2>
        {error && <div className="err set-error">{error}</div>}
        {group.kind === "prefs" && <General t={t} state={state} kernel={kernel} dispatch={dispatch} />}
        {group.kind === "model" && (
          <ModelAccess t={t} kernel={kernel}
            profiles={settings?.apiProfiles || []} activeProfileId={settings?.activeProfileId || null}
            onChanged={reload} />
        )}
        {group.kind === "config" && (
          <ConfigGroup t={t} group={group} draft={draft} setDraft={setDraft} onSave={saveConfig} dirty={dirty} saving={saving} />
        )}
        {group.kind === "about" && <About t={t} state={state} settings={settings} />}
      </div>
    </div>
  );
}

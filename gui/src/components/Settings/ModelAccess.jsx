import React, { useState } from "react";

const BLANK = { name: "", baseUrl: "https://api.deepseek.com", apiKey: "" };

// Model-access settings: manage a list of API endpoints (add/edit/delete/activate),
// fetch the model list from the active/selected endpoint (no default — error on failure),
// and test the connection. API keys are entered as passwords and never rendered back
// in plaintext (the bridge returns only a mask).
export default function ModelAccess({ t, kernel, profiles, activeProfileId, onChanged }) {
  const [form, setForm] = useState(null);       // null = not adding/editing
  const [models, setModels] = useState({});     // profileId → string[] | { error }
  const [busy, setBusy] = useState("");         // action-in-flight label
  const [test, setTest] = useState({});         // profileId → { ok, message }

  const startAdd = () => setForm({ ...BLANK });
  const startEdit = (p) => setForm({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "" }); // key blank = keep

  const saveForm = async () => {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    setBusy("save");
    const payload = { name: form.name.trim(), baseUrl: form.baseUrl.trim() };
    if (form.id) payload.id = form.id;
    if (form.apiKey) payload.apiKey = form.apiKey;               // omit → preserve existing key
    try { await kernel.saveApiProfile(payload); setForm(null); await onChanged(); }
    finally { setBusy(""); }
  };

  const del = async (id) => { setBusy("del:" + id); try { await kernel.deleteApiProfile(id); await onChanged(); } finally { setBusy(""); } };
  const activate = async (id) => { setBusy("act:" + id); try { await kernel.activateApiProfile(id); await onChanged(); } finally { setBusy(""); } };

  const fetchModels = async (id) => {
    setBusy("models:" + id);
    try {
      const list = await kernel.listModels(id);
      if (list && list.error) setModels((m) => ({ ...m, [id]: { error: list.error } }));
      else if (Array.isArray(list)) setModels((m) => ({ ...m, [id]: list }));
      else setModels((m) => ({ ...m, [id]: { error: t("settings.model.fetchFailed") } }));
    } catch (e) {
      setModels((m) => ({ ...m, [id]: { error: e.message || t("settings.model.fetchFailed") } }));
    } finally { setBusy(""); }
  };

  const chooseModel = async (p, model) => {
    if (!model) return;
    setBusy("pick:" + p.id);
    try { await kernel.saveApiProfile({ id: p.id, name: p.name, baseUrl: p.baseUrl, model }); await onChanged(); }
    finally { setBusy(""); }
  };

  const testConn = async (id) => {
    setBusy("test:" + id);
    try {
      const r = await kernel.testConnection(id);
      const ok = r && !r.error && (r.ok !== false);
      setTest((s) => ({ ...s, [id]: { ok, message: (r && (r.error || r.message)) || (ok ? t("settings.model.testOk") : t("settings.model.testFail")) } }));
    } catch (e) {
      setTest((s) => ({ ...s, [id]: { ok: false, message: e.message } }));
    } finally { setBusy(""); }
  };

  return (
    <div className="model-access">
      <div className="set-row-head">
        <h3>{t("settings.model.apis")}</h3>
        <button type="button" className="btn accent" onClick={startAdd}>{t("settings.model.add")}</button>
      </div>

      {(!profiles || profiles.length === 0) && !form && (
        <p className="dim">{t("settings.model.empty")}</p>
      )}

      <div className="api-list">
        {(profiles || []).map((p) => {
          const active = p.id === activeProfileId;
          const mlist = models[p.id];
          const tr = test[p.id];
          return (
            <div key={p.id} className={`api-card ${active ? "active" : ""}`}>
              <div className="api-top">
                <div className="api-name">
                  {p.name} {active && <span className="pill">{t("settings.model.active")}</span>}
                  {p.model && <span className="pill dim">{p.model}</span>}
                </div>
                <div className="api-actions">
                  {!active && <button type="button" className="btn" disabled={busy === "act:" + p.id} onClick={() => activate(p.id)}>{t("settings.model.activate")}</button>}
                  <button type="button" className="btn" onClick={() => startEdit(p)}>{t("settings.edit")}</button>
                  <button type="button" className="btn danger" disabled={busy === "del:" + p.id} onClick={() => del(p.id)}>{t("settings.delete")}</button>
                </div>
              </div>
              <div className="api-meta dim">{p.baseUrl} · {p.keyMask || (p.hasKey ? "••••" : t("settings.model.noKey"))}</div>
              <div className="api-tools">
                <button type="button" className="btn" disabled={busy === "models:" + p.id} onClick={() => fetchModels(p.id)}>{t("settings.model.fetch")}</button>
                {Array.isArray(mlist) && (
                  <select className="select" defaultValue={p.model || ""} onChange={(e) => chooseModel(p, e.target.value)} aria-label={t("settings.model.select")}>
                    <option value="" disabled>{t("settings.model.select")}</option>
                    {mlist.map((id) => <option key={id} value={id}>{id}</option>)}
                  </select>
                )}
                {mlist && mlist.error && <span className="err">{t("settings.model.fetchFailed")}: {mlist.error}</span>}
                <button type="button" className="btn" disabled={busy === "test:" + p.id} onClick={() => testConn(p.id)}>{t("settings.model.test")}</button>
                {tr && <span className={tr.ok ? "ok" : "err"}>{tr.message}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {form && (
        <div className="api-form">
          <h3>{form.id ? t("settings.model.editApi") : t("settings.model.newApi")}</h3>
          <label className="field"><span>{t("settings.model.name")}</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="deepseek" /></label>
          <label className="field"><span>{t("settings.model.baseUrl")}</span>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" /></label>
          <label className="field"><span>{t("settings.model.apiKey")}</span>
            <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={form.id ? t("settings.model.keyKeep") : "sk-…"} autoComplete="off" /></label>
          <div className="api-form-actions">
            <button type="button" className="btn accent" disabled={busy === "save"} onClick={saveForm}>{t("settings.save")}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>{t("settings.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

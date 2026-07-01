import React from "react";
import { formatRewindStatus } from "../state/workbench-state.js";

// Checkpoint rewind confirmation. Opens when a preview is loaded; shows impact, an optional
// force toggle for dirty workspaces, then applies (creating a new branch) or cancels.
export default function RewindDialog({ t, state, kernel, dispatch }) {
  const preview = state.rewindPreview || {};
  const result = state.rewindResult;
  const files = preview.files || preview.rollback_files || [];
  const count = preview.rollback_count ?? files.length;
  const blocked = preview.status && preview.status !== "success" && preview.status !== "ok";

  const close = () => dispatch({ type: "rewind_dismissed" });
  const confirm = () => kernel.applyRewind(state.selectedTarget, state.forceRewind);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("rewind.title")}>
        <div className="modal-head">{t("rewind.title")}</div>
        {!result ? (
          <>
            <div className="modal-body">
              <p>{t("rewind.summary")}</p>
              <ul className="rewind-meta">
                <li>{t("rewind.rollbackCount")}: <strong>{count}</strong></li>
                {preview.target && <li>{t("rewind.target")}: <code>{preview.target.turn_id || preview.target.event_id || `seq ${preview.target.seq}`}</code></li>}
                {blocked && <li className="err">{t("rewind.blocked")}: {preview.status}</li>}
              </ul>
              {files.length > 0 && (
                <div className="rewind-files">
                  {files.slice(0, 12).map((f, i) => <div key={i} className="mono dim">{typeof f === "string" ? f : (f.path || JSON.stringify(f))}</div>)}
                  {files.length > 12 && <div className="dim">… +{files.length - 12}</div>}
                </div>
              )}
              <label className="field checkbox">
                <input type="checkbox" checked={Boolean(state.forceRewind)} onChange={(e) => dispatch({ type: "force_rewind_changed", force: e.target.checked })} />
                <span>{t("rewind.force")}</span>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn accent" onClick={confirm}>{t("rewind.apply")}</button>
              <button type="button" className="btn" onClick={close}>{t("settings.cancel")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <p className={result.status === "success" ? "ok" : "err"}>{formatRewindStatus(result)}</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn accent" onClick={close}>{t("rewind.done")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

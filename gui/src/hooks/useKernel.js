import { useEffect, useMemo } from "react";
import { getApi } from "../lib/api.js";
import { buildInitialLoads, branchesAction, eventToAction, errorToAction } from "./kernel-loads.js";

// Subscribes to window.deepseek events → dispatch, runs first-paint loads, and exposes
// action wrappers. Pure mapping lives in kernel-loads.js (node:test-covered).
export function useKernel(dispatch) {
  const api = getApi();

  useEffect(() => {
    if (!api) {
      dispatch(errorToAction("connection", new Error("GUI bridge unavailable (running without Electron)")));
      return undefined;
    }
    let cancelled = false;
    const unsub = typeof api.onKernelEvent === "function"
      ? api.onKernelEvent((e) => dispatch(eventToAction(e)))
      : null;

    (async () => {
      for (const load of buildInitialLoads()) {
        const fn = api[load.call];
        if (typeof fn !== "function") continue;
        try {
          const res = await fn();
          if (!cancelled) dispatch(load.toAction(res));
        } catch (err) {
          if (!cancelled) dispatch(errorToAction(load.call, err));
        }
      }
      try {
        const [list, active] = await Promise.all([
          api.listBranches ? api.listBranches() : [],
          api.getActiveBranch ? api.getActiveBranch() : null
        ]);
        const activeId = active && (active.branch_id || active.id || active);
        if (!cancelled) dispatch(branchesAction(list, typeof activeId === "string" ? activeId : null));
      } catch (err) {
        if (!cancelled) dispatch(errorToAction("branches", err));
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsub === "function") unsub();
    };
  }, [api, dispatch]);

  return useMemo(() => ({
    available: Boolean(api),
    send: (message, opts) => api?.send?.(message, opts),
    approve: (id, decision) => api?.approve?.(id, decision),
    interrupt: () => api?.interrupt?.(),
    setPreferences: (patch) => api?.setPreferences?.(patch),
    rewindPreview: (o) => api?.rewindPreview?.(o),
    rewindApply: (o) => api?.rewindApply?.(o),
    openFile: async (path) => {
      if (!api?.readFile) return;
      try {
        const r = await api.readFile(path);
        if (r && r.error) dispatch(errorToAction("readFile", new Error(r.error)));
        else dispatch({ type: "file_opened", file: r });
      } catch (err) {
        dispatch(errorToAction("readFile", err));
      }
    }
  }), [api, dispatch]);
}

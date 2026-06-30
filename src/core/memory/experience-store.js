import { mkdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "../recovery/atomic-file.js";
import { FILE_SCHEMA_VERSION, validateEntry, validatePending } from "./experience-schema.js";

// Project-scoped experience store. All mutations go through a single async write
// queue (serialized), each persisting via atomicWriteJson (unique tmp -> rename) —
// no lost updates under concurrent consolidation/flush. Single in-memory snapshot.
export function createExperienceStore({ dir, now = () => Date.now() }) {
  mkdirSync(dir, { recursive: true });
  const libPath = path.join(dir, "experience.json");
  const pendingPath = path.join(dir, "pending.json");
  const evictLog = path.join(dir, "experience-evictions.jsonl");

  let entries = loadLib();
  let pending = loadPending();
  let queue = Promise.resolve();

  function loadLib() {
    if (!existsSync(libPath)) return [];
    try {
      const data = JSON.parse(readFileSync(libPath, "utf8"));
      if (!data || data.schemaVersion !== FILE_SCHEMA_VERSION || !Array.isArray(data.entries)) return [];
      return data.entries;
    } catch { return []; }
  }
  function loadPending() {
    if (!existsSync(pendingPath)) return [];
    try {
      const data = JSON.parse(readFileSync(pendingPath, "utf8"));
      return Array.isArray(data?.pending) ? data.pending : [];
    } catch { return []; }
  }

  function enqueue(fn) {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  }
  function persistLib() { return atomicWriteJson(libPath, { schemaVersion: FILE_SCHEMA_VERSION, entries }); }
  function persistPending() { return atomicWriteJson(pendingPath, { schemaVersion: FILE_SCHEMA_VERSION, pending }); }
  function logEviction(id, reason) {
    appendFileSync(evictLog, JSON.stringify({ id, reason, time: new Date(now()).toISOString() }) + "\n");
  }
  function upsertInto(arr, entry) {
    const i = arr.findIndex((e) => e.id === entry.id);
    if (i >= 0) arr[i] = entry; else arr.push(entry);
  }

  function all() { return entries.slice(); }
  function get(id) { return entries.find((e) => e.id === id) || null; }

  function put(entry) {
    const err = validateEntry(entry);
    if (err) return Promise.reject(new Error(`invalid experience entry: ${err}`));
    return enqueue(async () => { upsertInto(entries, entry); await persistLib(); });
  }

  function remove(id, reason = "removed") {
    return enqueue(async () => {
      const i = entries.findIndex((e) => e.id === id);
      if (i < 0) return;
      const [gone] = entries.splice(i, 1);
      logEviction(gone.id, reason);
      await persistLib();
    });
  }

  function replaceAll(next) {
    return enqueue(async () => { entries = (next || []).slice(); await persistLib(); });
  }

  // Batch-append eviction records (used by the upsert pipeline, which computes the
  // survivor set wholesale via replaceAll and logs evictions separately).
  function recordEvictions(records) {
    return enqueue(async () => {
      for (const r of records || []) logEviction(r.id, r.reason);
    });
  }

  function listPending() { return pending.slice(); }

  function putPending(p) {
    const err = validatePending(p);
    if (err) return Promise.reject(new Error(`invalid pending: ${err}`));
    return enqueue(async () => { pending.push(p); await persistPending(); });
  }

  function resolvePending(pendingId, decision) {
    return enqueue(async () => {
      const i = pending.findIndex((p) => p.pendingId === pendingId);
      if (i < 0) return;
      const [p] = pending.splice(i, 1);
      if (decision === "approve") {
        upsertInto(entries, p.entry);
        await persistLib();
      } else {
        logEviction(p.entry.id, "gated_denied");
      }
      await persistPending();
    });
  }

  // gated TTL: pending older than ttlMs are auto-denied (conservative — never auto-commit).
  function prunePending(ttlMs) {
    return enqueue(async () => {
      const cutoff = now() - ttlMs;
      const kept = [];
      let changed = false;
      for (const p of pending) {
        const t = Date.parse(p.created || "");
        if (Number.isFinite(t) && t < cutoff) { logEviction(p.entry.id, "gated_expired"); changed = true; }
        else kept.push(p);
      }
      if (changed) { pending = kept; await persistPending(); }
    });
  }

  function flush() { return queue; }

  return { all, get, put, remove, replaceAll, recordEvictions, listPending, putPending, resolvePending, prunePending, flush };
}

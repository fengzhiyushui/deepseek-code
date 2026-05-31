import { promises as fs } from "node:fs";
import path from "node:path";
import { makeId } from "../shared/id.js";
import { nowIso } from "../shared/time.js";

export const BRANCH_SCHEMA_VERSION = 1;
export const BR_MAIN = "br_main";

export async function createBranchStore({ sessionRoot, projectId, sessionId } = {}) {
  if (!sessionRoot) throw new Error("sessionRoot is required");
  if (!projectId) throw new Error("projectId is required");
  if (!sessionId) throw new Error("sessionId is required");
  const filePath = branchFilePath(sessionRoot, projectId, sessionId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let state = await loadState(filePath, sessionId);
  await saveState(filePath, state);

  async function persist(next) {
    state = normalizeState(next, sessionId);
    await saveState(filePath, state);
    return snapshot(state);
  }

  async function listBranches() {
    return snapshot(state).branches;
  }

  async function getActiveBranchId() {
    return state.active_branch_id || BR_MAIN;
  }

  async function getBranch(branchId = state.active_branch_id) {
    const branch = state.branches.find((item) => item.branch_id === branchId);
    if (!branch) throw new Error(`unknown branch: ${branchId}`);
    return { ...branch };
  }

  async function createBranch({
    parent_branch_id = state.active_branch_id || BR_MAIN,
    forked_from_event_id = null,
    forked_from_seq = 0,
    forked_from_turn_id = null,
    label = "",
    branch_id = null
  } = {}) {
    await getBranch(parent_branch_id);
    const id = (branch_id && /^br_[a-zA-Z0-9._-]+$/.test(branch_id))
      ? branch_id
      : makeId("br");
    const branch = {
      branch_id: id,
      parent_branch_id,
      forked_from_event_id,
      forked_from_seq: Number(forked_from_seq || 0),
      forked_from_turn_id,
      created_at: nowIso(),
      label: label || `rewind from ${parent_branch_id}`
    };
    await persist({ ...state, branches: [...state.branches, branch] });
    return { ...branch };
  }

  async function activateBranch(branchId) {
    await getBranch(branchId);
    await persist({ ...state, active_branch_id: branchId });
    return getBranch(branchId);
  }

  async function getAncestry(branchId = state.active_branch_id || BR_MAIN) {
    const byId = new Map(state.branches.map((branch) => [branch.branch_id, branch]));
    const chain = [];
    let cursor = byId.get(branchId);
    if (!cursor) throw new Error(`unknown branch: ${branchId}`);
    while (cursor) {
      chain.push({ ...cursor });
      cursor = cursor.parent_branch_id ? byId.get(cursor.parent_branch_id) : null;
    }
    return chain.reverse();
  }

  return {
    filePath,
    listBranches,
    getActiveBranchId,
    getBranch,
    createBranch,
    activateBranch,
    getAncestry
  };
}

function branchFilePath(sessionRoot, projectId, sessionId) {
  return path.join(sessionRoot, sanitize(projectId), `${sanitize(sessionId)}.branches.json`);
}

async function loadState(filePath, sessionId) {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return normalizeState(raw, sessionId);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return normalizeState({}, sessionId);
  }
}

function normalizeState(raw, sessionId) {
  const branches = Array.isArray(raw.branches) ? raw.branches.filter(Boolean).map(normalizeBranch) : [];
  if (!branches.some((branch) => branch.branch_id === BR_MAIN)) {
    branches.unshift({
      branch_id: BR_MAIN,
      parent_branch_id: null,
      forked_from_event_id: null,
      forked_from_seq: 0,
      forked_from_turn_id: null,
      created_at: nowIso(),
      label: "main"
    });
  }
  const active = branches.some((branch) => branch.branch_id === raw.active_branch_id)
    ? raw.active_branch_id
    : BR_MAIN;
  return {
    schema_version: BRANCH_SCHEMA_VERSION,
    session_id: raw.session_id || sessionId,
    active_branch_id: active,
    branches
  };
}

function normalizeBranch(branch) {
  return {
    branch_id: sanitizeBranchId(branch.branch_id || makeId("br")),
    parent_branch_id: branch.parent_branch_id || null,
    forked_from_event_id: branch.forked_from_event_id || null,
    forked_from_seq: Number(branch.forked_from_seq || 0),
    forked_from_turn_id: branch.forked_from_turn_id || null,
    created_at: branch.created_at || nowIso(),
    label: String(branch.label || "")
  };
}

async function saveState(filePath, state) {
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function sanitizeBranchId(value) {
  const id = String(value || "");
  if (!/^br_[a-zA-Z0-9._-]+$/.test(id)) throw new Error(`invalid branch id: ${value}`);
  return id.slice(0, 80);
}

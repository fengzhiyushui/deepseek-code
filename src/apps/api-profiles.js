// src/apps/api-profiles.js — 模型 API 配置列表(名称/baseUrl/apiKey/model),GUI 与 TUI 共享一份实现与存储。
// 存 .deepseek-code/(随仓忽略);激活时由调用方把凭据写进 config.json 供内核读(kernel 不变)。
// 存储文件名 gui-api-profiles.json 是历史遗留,保留以兼容既有用户数据。
import fsp from "node:fs/promises";
import path from "node:path";

export function createApiProfiles({ dir }) {
  const file = path.join(dir, "gui-api-profiles.json");

  async function load() {
    try {
      const raw = JSON.parse(await fsp.readFile(file, "utf8"));
      return {
        profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
        activeId: raw.activeId || null,
        seq: Number.isInteger(raw.seq) ? raw.seq : 0
      };
    } catch {
      return { profiles: [], activeId: null, seq: 0 };
    }
  }

  async function persist(state) {
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fsp.rename(tmp, file);
  }

  async function list() { return (await load()).profiles; }

  async function save(profile) {
    const state = await load();
    let saved;
    if (profile.id && state.profiles.some((p) => p.id === profile.id)) {
      saved = { ...state.profiles.find((p) => p.id === profile.id), ...profile };
      state.profiles = state.profiles.map((p) => (p.id === profile.id ? saved : p));
    } else {
      state.seq += 1;
      saved = { ...profile, id: `p_${state.seq}` };
      state.profiles.push(saved);
    }
    await persist(state);
    return saved;
  }

  async function remove(id) {
    const state = await load();
    state.profiles = state.profiles.filter((p) => p.id !== id);
    if (state.activeId === id) state.activeId = null;
    await persist(state);
  }

  async function activate(id) {
    const state = await load();
    const target = state.profiles.find((p) => p.id === id);
    if (!target) throw new Error(`no such API profile: ${id}`);
    state.activeId = id;
    await persist(state);
    return target;
  }

  async function getActive() {
    const state = await load();
    return state.profiles.find((p) => p.id === state.activeId) || null;
  }

  return { list, save, remove, activate, getActive };
}

export function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  if (k.length <= 8) return "•••";
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}

// gui/src/state/session-groups.js — 会话列表的日期分组、时间戳与搜索过滤(纯函数,node:test 覆盖)。
// 设计稿 v4 的侧栏把每个项目的会话按「今天 / 昨天 / 本周 / 更早」分段,右侧显示相对时间戳;
// 这里只做数据整形,文案与本地化交给组件(返回 weekday 序号而非中英文字串)。

export const DAY_BUCKETS = ["today", "yesterday", "thisWeek", "earlier"];

const DAY_MS = 24 * 60 * 60 * 1000;

// 当天 00:00 的时间戳(本地时区)。
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayBucket(mtime, now = Date.now()) {
  const today = startOfDay(now);
  const stamp = Number(mtime) || 0;
  if (stamp >= today) return "today";
  if (stamp >= today - DAY_MS) return "yesterday";
  if (stamp >= today - 7 * DAY_MS) return "thisWeek";
  return "earlier";
}

// 时间戳形态:今天/昨天给「时:分」,本周给星期序号,更早给「月-日」。
export function sessionStamp(mtime, now = Date.now()) {
  const bucket = dayBucket(mtime, now);
  const d = new Date(Number(mtime) || 0);
  const pad = (n) => String(n).padStart(2, "0");
  if (bucket === "today" || bucket === "yesterday") {
    return { kind: "time", bucket, text: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  if (bucket === "thisWeek") {
    return { kind: "weekday", bucket, weekday: d.getDay(), text: "" };
  }
  return { kind: "date", bucket, text: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
}

// 按日期分段;空段不返回,段内保持传入顺序(session-index 已按 mtime 倒序)。
export function groupSessionsByDate(sessions, now = Date.now()) {
  const buckets = new Map(DAY_BUCKETS.map((b) => [b, []]));
  for (const s of sessions || []) buckets.get(dayBucket(s && s.mtime, now)).push(s);
  return DAY_BUCKETS
    .map((bucket) => ({ bucket, sessions: buckets.get(bucket) }))
    .filter((g) => g.sessions.length > 0);
}

export function matchesQuery(text, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return String(text || "").toLowerCase().includes(q);
}

// 侧栏搜索:命中项目名/路径则整个项目保留,否则只留命中的会话;都不命中则丢弃该项目。
export function filterProjectTree(projects, sessionsByProject, query) {
  const q = String(query || "").trim();
  const groupOf = (id) => {
    const g = (sessionsByProject || []).find((x) => x.projectDir === id);
    return g ? g.sessions : [];
  };
  if (!q) return (projects || []).map((p) => ({ project: p, sessions: groupOf(p.id), matchedProject: false }));

  const result = [];
  for (const p of projects || []) {
    const sessions = groupOf(p.id);
    const matchedProject = matchesQuery(p.name, q) || matchesQuery(p.root, q);
    if (matchedProject) { result.push({ project: p, sessions, matchedProject: true }); continue; }
    const hit = sessions.filter((s) => matchesQuery(s.summary, q));
    if (hit.length) result.push({ project: p, sessions: hit, matchedProject: false });
  }
  return result;
}

// 首页「最近会话」:跨项目取最新 N 条,附带项目归属。
export function recentSessions(projects, sessionsByProject, limit = 5) {
  const nameOf = (id) => {
    const p = (projects || []).find((x) => x.id === id);
    return p ? p.name : id;
  };
  const flat = [];
  for (const group of sessionsByProject || []) {
    for (const s of group.sessions || []) flat.push({ ...s, projectDir: group.projectDir, projectName: nameOf(group.projectDir) });
  }
  flat.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return flat.slice(0, Math.max(0, limit));
}

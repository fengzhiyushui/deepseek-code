import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_BUCKETS, dayBucket, sessionStamp, groupSessionsByDate,
  matchesQuery, filterProjectTree, recentSessions
} from "../../../gui/src/state/session-groups.js";

// 固定「现在」= 2026-07-31 15:00 本地时间,避免测试随真实时钟漂移。
const NOW = new Date(2026, 6, 31, 15, 0, 0).getTime();
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m, d, hh, mm, 0).getTime();

test("dayBucket:今天/昨天/本周/更早四段边界", () => {
  assert.equal(DAY_BUCKETS.length, 4);
  assert.equal(dayBucket(at(2026, 6, 31, 0, 1), NOW), "today");
  assert.equal(dayBucket(at(2026, 6, 30, 23, 59), NOW), "yesterday");
  assert.equal(dayBucket(at(2026, 6, 27), NOW), "thisWeek");
  assert.equal(dayBucket(at(2026, 6, 20), NOW), "earlier");
  assert.equal(dayBucket(0, NOW), "earlier");
  assert.equal(dayBucket(undefined, NOW), "earlier");
});

test("sessionStamp:今天给时:分,本周给星期序号,更早给月-日", () => {
  assert.deepEqual(sessionStamp(at(2026, 6, 31, 9, 5), NOW), { kind: "time", bucket: "today", text: "09:05" });
  assert.equal(sessionStamp(at(2026, 6, 30, 18, 22), NOW).text, "18:22");
  const week = sessionStamp(at(2026, 6, 28, 10, 0), NOW); // 2026-07-28 是周二
  assert.equal(week.kind, "weekday");
  assert.equal(week.weekday, new Date(2026, 6, 28).getDay());
  assert.deepEqual(sessionStamp(at(2026, 5, 9, 8, 0), NOW), { kind: "date", bucket: "earlier", text: "06-09" });
});

test("groupSessionsByDate:空段不出现,段内顺序保持", () => {
  const sessions = [
    { id: "a", mtime: at(2026, 6, 31, 12, 40) },
    { id: "b", mtime: at(2026, 6, 31, 11, 2) },
    { id: "c", mtime: at(2026, 6, 20) }
  ];
  const groups = groupSessionsByDate(sessions, NOW);
  assert.deepEqual(groups.map((g) => g.bucket), ["today", "earlier"]);
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ["a", "b"]);
  assert.deepEqual(groupSessionsByDate([], NOW), []);
  assert.deepEqual(groupSessionsByDate(null, NOW), []);
});

test("matchesQuery:空查询恒真,大小写不敏感", () => {
  assert.equal(matchesQuery("Login.jsx", ""), true);
  assert.equal(matchesQuery("Login.jsx", "  "), true);
  assert.equal(matchesQuery("重构登录页", "登录"), true);
  assert.equal(matchesQuery("Login.jsx", "LOGIN"), true);
  assert.equal(matchesQuery(null, "x"), false);
});

const PROJECTS = [
  { id: "proj_a", name: "inkstone", root: "D:\\studio\\inkstone" },
  { id: "proj_b", name: "shop-frontend", root: "D:\\work\\shop-frontend" }
];
const SESSIONS = [
  { projectDir: "proj_a", sessions: [{ id: "1", summary: "重构登录页", mtime: at(2026, 6, 31, 12, 40) }] },
  { projectDir: "proj_b", sessions: [{ id: "2", summary: "购物车结算", mtime: at(2026, 6, 31, 14, 5) }] }
];

test("filterProjectTree:无查询返回全部;命中项目名保留整项目", () => {
  const all = filterProjectTree(PROJECTS, SESSIONS, "");
  assert.equal(all.length, 2);
  assert.equal(all[0].sessions.length, 1);

  const byProject = filterProjectTree(PROJECTS, SESSIONS, "shop");
  assert.equal(byProject.length, 1);
  assert.equal(byProject[0].project.id, "proj_b");
  assert.equal(byProject[0].matchedProject, true);
});

test("filterProjectTree:只命中会话时只留命中的会话;全不命中则丢弃", () => {
  const bySession = filterProjectTree(PROJECTS, SESSIONS, "登录");
  assert.equal(bySession.length, 1);
  assert.equal(bySession[0].project.id, "proj_a");
  assert.equal(bySession[0].matchedProject, false);
  assert.deepEqual(bySession[0].sessions.map((s) => s.id), ["1"]);

  assert.deepEqual(filterProjectTree(PROJECTS, SESSIONS, "不存在的关键词"), []);
});

test("filterProjectTree:路径命中也算项目命中", () => {
  const hit = filterProjectTree(PROJECTS, SESSIONS, "D:\\work");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].project.id, "proj_b");
});

test("recentSessions:跨项目按 mtime 倒序,带项目名,受 limit 约束", () => {
  const recent = recentSessions(PROJECTS, SESSIONS, 5);
  assert.deepEqual(recent.map((s) => s.id), ["2", "1"]);
  assert.equal(recent[0].projectName, "shop-frontend");
  assert.equal(recentSessions(PROJECTS, SESSIONS, 1).length, 1);
  assert.deepEqual(recentSessions(PROJECTS, SESSIONS, 0), []);
  assert.deepEqual(recentSessions(null, null, 3), []);
});

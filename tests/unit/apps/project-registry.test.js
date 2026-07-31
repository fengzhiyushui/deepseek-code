import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createProjectRegistry, projectIdFromRoot } from "../../../src/apps/project-registry.js";

async function withRegistry(fn) {
  const base = await mkdtemp(path.join(tmpdir(), "inkstone-registry-"));
  const dir = path.join(base, ".deepseek-code");
  await mkdir(dir, { recursive: true });
  const reg = createProjectRegistry({ dir });
  await fn({ reg, dir, base });
}

test("touch 登记项目并置顶;重复 touch 去重", async () => {
  await withRegistry(async ({ reg, base }) => {
    const a = path.join(base, "a");
    const b = path.join(base, "b");
    await mkdir(a);
    await mkdir(b);

    await reg.touch(a);
    await reg.touch(b);
    await reg.touch(a); // 再次打开 a → 去重并置顶

    const list = await reg.list();
    assert.equal(list.length, 2, `期望 2 项,实得 ${list.length}`);
    assert.equal(list[0].root, a, "最近打开的 a 应置顶");
    assert.equal(list[0].id, projectIdFromRoot(a));
    assert.equal(list[1].root, b);
    assert.ok(list.every((p) => p.name && p.lastOpened > 0));
  });
});

test("root 不存在时 touch 拒绝", async () => {
  await withRegistry(async ({ reg, base }) => {
    await assert.rejects(() => reg.touch(path.join(base, "missing")), /does not exist/);
  });
});

test("损坏文件容错:读回默认空表", async () => {
  await withRegistry(async ({ reg, dir, base }) => {
    await writeFile(path.join(dir, "projects.json"), "{ broken json", "utf8");
    assert.deepEqual(await reg.list(), []);
    // 写后仍可正常使用
    await mkdir(path.join(base, "ok"));
    await reg.touch(path.join(base, "ok"));
    assert.equal((await reg.list()).length, 1);
  });
});

test("remove 按 root 或 id 移除", async () => {
  await withRegistry(async ({ reg, base }) => {
    const a = path.join(base, "a");
    await mkdir(a);
    await reg.touch(a);
    await reg.remove(a);
    assert.deepEqual(await reg.list(), []);
  });
});

test("持久化到磁盘可跨实例读取", async () => {
  await withRegistry(async ({ reg, dir, base }) => {
    const a = path.join(base, "a");
    await mkdir(a);
    await reg.touch(a);
    const raw = JSON.parse(await readFile(path.join(dir, "projects.json"), "utf8"));
    assert.equal(raw.projects.length, 1);
    assert.equal(raw.projects[0].root, a);
  });
});

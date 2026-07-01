import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPtyHost } = require("../../../gui/pty-host.js");

test("pty lifecycle: start/write/resize/kill via injected spawn", () => {
  const calls = [];
  const fakePty = {
    onData: (cb) => { fakePty._cb = cb; },
    write: (d) => calls.push(["write", d]),
    resize: (c, r) => calls.push(["resize", c, r]),
    kill: () => calls.push(["kill"])
  };
  const spawn = (shell, args, opts) => { calls.push(["spawn", shell, opts.cwd]); return fakePty; };
  let out = "";
  const host = createPtyHost({ spawn, cwd: "/proj", shell: "bash", onData: (d) => { out += d; } });
  assert.equal(host.available, true);
  host.start(80, 24);
  fakePty._cb("hello");
  host.write("ls\n");
  host.resize(100, 30);
  host.kill();
  assert.ok(calls.some((c) => c[0] === "spawn" && c[2] === "/proj"));
  assert.equal(out, "hello");
  assert.deepEqual(calls.filter((c) => c[0] !== "spawn"), [["write", "ls\n"], ["resize", 100, 30], ["kill"]]);
});

test("unavailable spawn → available=false, no throw", () => {
  const host = createPtyHost({ spawn: null });
  assert.equal(host.available, false);
  host.start();
  host.write("x");
  host.resize(1, 1);
  host.kill(); // all no-ops, no throw
});

test("start is idempotent (single pty)", () => {
  let spawns = 0;
  const fakePty = { onData: () => {}, write: () => {}, resize: () => {}, kill: () => {} };
  const host = createPtyHost({ spawn: () => { spawns += 1; return fakePty; }, cwd: "/p" });
  host.start(); host.start();
  assert.equal(spawns, 1);
});

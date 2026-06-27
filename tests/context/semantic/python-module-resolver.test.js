import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePythonModule } from "../../../src/context/semantic/python-module-resolver.js";

const fileSet = new Set(["pkg/__init__.py", "pkg/mod.py", "pkg/sub/__init__.py", "app/main.py", "util.py"]);

test("relative imports resolve by level", () => {
  // from .mod import x  (in app/main.py) -> level 1, spec "mod" -> app/mod.py absent
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "mod", level: 1, fileSet, importRoots: [] }), null);
  // from . import x (in pkg/mod.py) -> level 1 spec "" -> package pkg -> pkg/__init__.py
  assert.equal(resolvePythonModule({ fromFile: "pkg/mod.py", spec: "", level: 1, fileSet, importRoots: [] }), "pkg/__init__.py");
  // from .sub import y (in pkg/mod.py) -> pkg/sub/__init__.py
  assert.equal(resolvePythonModule({ fromFile: "pkg/mod.py", spec: "sub", level: 1, fileSet, importRoots: [] }), "pkg/sub/__init__.py");
});

test("absolute imports resolve from project root / import roots", () => {
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "pkg.mod", level: 0, fileSet, importRoots: [] }), "pkg/mod.py");
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "util", level: 0, fileSet, importRoots: [] }), "util.py");
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "os", level: 0, fileSet, importRoots: [] }), null); // external
});

test("importRoots are appended (src/ as a root)", () => {
  const fs2 = new Set(["src/pkg/mod.py"]);
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "pkg.mod", level: 0, fileSet: fs2, importRoots: ["src"] }), "src/pkg/mod.py");
});

test("module file wins over package __init__; namespace package w/o __init__ -> null", () => {
  const fs2 = new Set(["pkg.py", "pkg/__init__.py", "ns/leaf.py"]); // pkg both as module and package
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "pkg", level: 0, fileSet: fs2, importRoots: [] }), "pkg.py");
  // "ns" dir exists in paths but has no __init__.py and no ns.py -> external (null)
  assert.equal(resolvePythonModule({ fromFile: "app/main.py", spec: "ns", level: 0, fileSet: fs2, importRoots: [] }), null);
});

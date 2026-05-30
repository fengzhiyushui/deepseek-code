import test from "node:test";
import assert from "node:assert/strict";
import {
  createPermissionEngine,
  DEFAULT_POLICY_MATRIX,
  globMatch
} from "../../../src/tools/permissions/permission-engine.js";
import { createPolicyContext } from "../../../src/tools/permissions/policy-loader.js";

test("default matrix covers 8 categories across 4 autonomy levels", () => {
  const categories = ["read", "read_secret", "write_create", "write_update", "write_delete", "execute", "network", "destructive"];
  for (const autonomy of ["supervised", "gated", "auto", "full-auto"]) {
    assert.deepEqual(Object.keys(DEFAULT_POLICY_MATRIX[autonomy]).sort(), categories.sort());
  }
});

test("destructive is denied before trust rules", () => {
  const engine = createPermissionEngine();
  const decision = engine.decide(
    { name: "delete_repo", category: "destructive", params: {} },
    createPolicyContext({
      autonomy: "full-auto",
      trustStore: { rules: [{ id: "allow-all", category: "destructive", decision: "allow" }] }
    })
  );

  assert.equal(decision.decision, "deny");
  assert.equal(decision.source, "safety-invariant");
});

test("user rules override project rules and default matrix", () => {
  const engine = createPermissionEngine();
  const call = { name: "write", category: "write_update", params: { path: "src/app.js" } };
  const ctx = createPolicyContext({
    autonomy: "supervised",
    trustStore: { rules: [{ id: "user-allow-src", category: "write_update", pattern: "src/**", decision: "allow" }] },
    projectRules: [{ id: "project-deny-src", category: "write_update", pattern: "src/**", decision: "deny" }]
  });

  const decision = engine.decide(call, ctx);

  assert.equal(decision.decision, "allow");
  assert.equal(decision.source, "user-trust-store");
});

test("rule pattern requires call path", () => {
  const engine = createPermissionEngine();
  const decision = engine.decide(
    { name: "shell", category: "execute", params: { argv: ["npm", "test"] } },
    createPolicyContext({
      autonomy: "supervised",
      trustStore: { rules: [{ id: "path-rule", category: "execute", pattern: "src/**", decision: "allow" }] }
    })
  );

  assert.equal(decision.decision, "ask");
  assert.equal(decision.source, "default-matrix");
});

test("argv rule matches exact argv only", () => {
  const engine = createPermissionEngine();
  const ctx = createPolicyContext({
    autonomy: "supervised",
    trustStore: { rules: [{ id: "allow-npm-test", category: "execute", match: { argv: ["npm", "test"] }, decision: "allow" }] }
  });

  assert.equal(engine.decide({ name: "shell", category: "execute", params: { argv: ["npm", "test"] } }, ctx).decision, "allow");
  assert.equal(engine.decide({ name: "shell", category: "execute", params: { argv: ["npm", "run", "test"] } }, ctx).decision, "ask");
});

test("globMatch supports recursive and single-segment globs", () => {
  assert.equal(globMatch("src/**", "src/a/b.js"), true);
  assert.equal(globMatch("src/*.js", "src/app.js"), true);
  assert.equal(globMatch("src/*.js", "src/nested/app.js"), false);
});

test("fingerprint is deterministic for tool path argv and project", () => {
  const engine = createPermissionEngine();
  const ctx = createPolicyContext({ projectId: "proj_1" });
  const a = engine.fingerprint({ name: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "." } }, ctx);
  const b = engine.fingerprint({ name: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "." } }, ctx);
  assert.equal(a, b);
  assert.match(a, /^fp:/);
});

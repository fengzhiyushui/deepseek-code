// test/kernel/permission-engine.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createPermissionEngine, DEFAULT_POLICY_MATRIX } from "../../src/kernel/permission-engine.js";

function testContext(overrides = {}) {
  return {
    autonomy: "gated",
    channel: "act",
    projectRoot: "/test/project",
    projectId: "test-project",
    trustStore: {},
    ...overrides
  };
}

function testToolCall(overrides = {}) {
  return {
    id: "call_001",
    tool: "write",
    category: "write_update",
    risk_level: "medium",
    side_effect: "filesystem",
    params: { path: "src/index.js" },
    ...overrides
  };
}

// --- Policy Matrix Tests ---

test("gated autonomy allows write_update by default", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(testToolCall(), testContext());
  assert.equal(result.decision, "allow");
});

test("gated autonomy requires ask for write_delete", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(
    testToolCall({ tool: "delete", category: "write_delete" }),
    testContext()
  );
  assert.equal(result.decision, "ask");
});

test("supervised autonomy requires ask for write_update", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(
    testToolCall(),
    testContext({ autonomy: "supervised" })
  );
  assert.equal(result.decision, "ask");
});

test("destructive is always deny, even full-auto", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(
    testToolCall({ tool: "rm", category: "destructive", risk_level: "critical" }),
    testContext({ autonomy: "full-auto" })
  );
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "safety-invariant");
});

test("destructive cannot be overridden by trust rules", () => {
  const engine = createPermissionEngine();
  const ctx = testContext({
    autonomy: "full-auto",
    trustStore: {
      rules: [{
        id: "evil-rule",
        category: "destructive",
        decision: "allow"
      }]
    }
  });
  const result = engine.decide(
    testToolCall({ tool: "rm", category: "destructive", risk_level: "critical" }),
    ctx
  );
  // Trust rule cannot override the destructive safety invariant
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "safety-invariant");
});

test("read_secret is always ask, even full-auto", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(
    testToolCall({ tool: "read", category: "read_secret", params: { path: ".env" } }),
    testContext({ autonomy: "full-auto" })
  );
  assert.equal(result.decision, "ask");
});

test("read operations are auto in all autonomy levels", () => {
  const engine = createPermissionEngine();
  for (const autonomy of ["supervised", "gated", "auto", "full-auto"]) {
    const result = engine.decide(
      testToolCall({ tool: "read", category: "read", risk_level: "low", side_effect: "none" }),
      testContext({ autonomy })
    );
    assert.equal(result.decision, "allow", `read should be allow in ${autonomy}`);
  }
});

// --- Full 8×4 Matrix Test ---

test("all 32 default matrix entries are defined", () => {
  const engine = createPermissionEngine();
  const categories = ["read", "read_secret", "write_create", "write_update", "write_delete", "execute", "network", "destructive"];
  const autonomyLevels = ["supervised", "gated", "auto", "full-auto"];
  for (const autonomy of autonomyLevels) {
    for (const category of categories) {
      const result = engine.decide(
        { id: "mat", tool: "test", category, risk_level: "medium", params: {} },
        { autonomy, channel: "act", projectRoot: "/test", projectId: "test", trustStore: {} }
      );
      assert.ok(["allow", "deny", "ask"].includes(result.decision),
        `${autonomy}/${category} → ${result.decision}`);
    }
  }
});

test("matrix entries match spec: supervised", () => {
  const engine = createPermissionEngine();
  const ctx = { autonomy: "supervised", channel: "act", projectRoot: "/t", projectId: "t", trustStore: {} };
  assert.equal(engine.decide({ id:"m",tool:"t",category:"read",risk_level:"low",params:{}},ctx).decision, "allow");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"read_secret",risk_level:"medium",params:{}},ctx).decision, "ask");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"write_create",risk_level:"medium",params:{}},ctx).decision, "ask");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"destructive",risk_level:"critical",params:{}},ctx).decision, "deny");
});

test("matrix entries match spec: full-auto", () => {
  const engine = createPermissionEngine();
  const ctx = { autonomy: "full-auto", channel: "act", projectRoot: "/t", projectId: "t", trustStore: {} };
  assert.equal(engine.decide({ id:"m",tool:"t",category:"read",risk_level:"low",params:{}},ctx).decision, "allow");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"write_update",risk_level:"medium",params:{}},ctx).decision, "allow");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"execute",risk_level:"medium",params:{}},ctx).decision, "allow");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"network",risk_level:"medium",params:{}},ctx).decision, "allow");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"read_secret",risk_level:"medium",params:{}},ctx).decision, "ask");
  assert.equal(engine.decide({ id:"m",tool:"t",category:"destructive",risk_level:"critical",params:{}},ctx).decision, "deny");
});

// --- Trust Hierarchy Tests ---

test("user-level rule overrides default matrix", () => {
  const engine = createPermissionEngine();
  const ctx = testContext({
    trustStore: {
      rules: [{
        id: "user-deny-writes",
        category: "write_update",
        pattern: "src/**",
        decision: "deny"
      }]
    }
  });
  const result = engine.decide(
    testToolCall({ category: "write_update", params: { path: "src/index.js" } }),
    ctx
  );
  assert.equal(result.decision, "deny");
  assert.equal(result.matched_rule, "user-deny-writes");
});

test("project rule overrides default but not user rule", () => {
  const engine = createPermissionEngine();
  const ctx = testContext({
    projectRules: [{
      id: "project-allow-writes",
      category: "write_update",
      decision: "allow"
    }],
    trustStore: {
      rules: [{
        id: "user-ask-writes",
        category: "write_update",
        decision: "ask"
      }]
    }
  });
  const result = engine.decide(
    testToolCall({ category: "write_update" }),
    ctx
  );
  assert.equal(result.decision, "ask");
  assert.equal(result.matched_rule, "user-ask-writes");
});

// --- Shell Command Matching ---

test("shell command matches by normalized argv", () => {
  const engine = createPermissionEngine();
  const ctx = testContext({
    trustStore: {
      rules: [{
        id: "allow-npm-test",
        category: "execute",
        match: { argv: ["npm", "test"] },
        decision: "allow"
      }]
    }
  });
  const result = engine.decide(
    testToolCall({ tool: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "/test/project", shell: false } }),
    ctx
  );
  assert.equal(result.decision, "allow");
});

test("shell command without matching rule falls to matrix default", () => {
  const engine = createPermissionEngine();
  const result = engine.decide(
    testToolCall({ tool: "shell", category: "execute", params: { argv: ["rm", "-rf", "/"], cwd: "/test/project", shell: false } }),
    testContext({ autonomy: "gated" })
  );
  assert.equal(result.decision, "ask");
});

// --- Glob Pattern Matching ---

test("glob ** matches recursive paths", () => {
  const engine = createPermissionEngine();
  const ctx = testContext({
    trustStore: {
      rules: [{
        id: "allow-src-recursive",
        category: "write_update",
        pattern: "src/**",
        decision: "allow"
      }]
    }
  });
  // ** should match one level
  assert.equal(engine.decide(
    testToolCall({ category: "write_update", params: { path: "src/index.js" } }), ctx
  ).decision, "allow");
  // ** should match multiple levels
  assert.equal(engine.decide(
    testToolCall({ category: "write_update", params: { path: "src/a/b/c/deep.js" } }), ctx
  ).decision, "allow");
});

test("glob * matches single segment only", () => {
  const engine = createPermissionEngine();
  // Use supervised so write_update defaults to "ask" — we can distinguish
  // "rule matched (deny)" from "fell to matrix (ask)".
  const ctx = testContext({
    autonomy: "supervised",
    trustStore: {
      rules: [{
        id: "deny-src-single",
        category: "write_update",
        pattern: "src/*.js",
        decision: "deny"
      }]
    }
  });
  // src/index.js matches src/*.js → rule hits → deny
  assert.equal(engine.decide(
    testToolCall({ category: "write_update", params: { path: "src/index.js" } }), ctx
  ).decision, "deny");
  // src/a/index.js does NOT match src/*.js → rule misses → falls to matrix (supervised+write_update=ask)
  assert.equal(engine.decide(
    testToolCall({ category: "write_update", params: { path: "src/a/index.js" } }), ctx
  ).decision, "ask");
});

// --- TTL Fingerprint ---

test("fingerprint is deterministic for same tool call", () => {
  const engine = createPermissionEngine();
  const ctx = testContext();
  const call1 = testToolCall({ tool: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "/test/project" } });
  const call2 = testToolCall({ tool: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "/test/project" } });
  assert.equal(engine.fingerprint(call1, ctx), engine.fingerprint(call2, ctx));
});

test("fingerprint differs for different argv", () => {
  const engine = createPermissionEngine();
  const ctx = testContext();
  const call1 = testToolCall({ tool: "shell", category: "execute", params: { argv: ["npm", "test"], cwd: "/test/project" } });
  const call2 = testToolCall({ tool: "shell", category: "execute", params: { argv: ["npm", "install"], cwd: "/test/project" } });
  assert.notEqual(engine.fingerprint(call1, ctx), engine.fingerprint(call2, ctx));
});

test("explain returns matched rules and reason", () => {
  const engine = createPermissionEngine();
  const explanation = engine.explain(testToolCall(), testContext());
  assert.ok(typeof explanation.decision === "string");
  assert.ok(typeof explanation.reason === "string");
  assert.ok(explanation.reason.length > 0);
});

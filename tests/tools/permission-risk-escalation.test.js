import { test } from "node:test";
import assert from "node:assert/strict";
import { createPermissionEngine } from "../../src/tools/permissions/permission-engine.js";
import { riskRules } from "../../src/core/memory/risk-rules.js";

const pe = createPermissionEngine();
const esc = riskRules(new Set(["migrate"]));            // [{ escalate_only, cue:"migrate", id }]
const writeMigrate = { name: "edit", category: "write_update", params: { path: "db/migrate/001.js" } };
const writePlain = { name: "edit", category: "write_update", params: { path: "src/util.js" } };

test("default-matrix allow + risk cue match => ask (escalated)", () => {
  const d = pe.decide(writeMigrate, { autonomy: "gated", projectRules: esc });
  assert.equal(d.decision, "ask");
  assert.equal(d.source, "risk-experience");
  assert.equal(d.escalated, true);
});

test("no cue match => allow unchanged", () => {
  const d = pe.decide(writePlain, { autonomy: "gated", projectRules: esc });
  assert.equal(d.decision, "allow");
  assert.equal(d.source, "default-matrix");
});

test("never downgrades a deny (read-only write stays deny)", () => {
  const d = pe.decide(writeMigrate, { autonomy: "read-only", projectRules: esc });
  assert.equal(d.decision, "deny");
});

test("never downgrades an ask (supervised write stays ask)", () => {
  const d = pe.decide(writeMigrate, { autonomy: "supervised", projectRules: esc });
  assert.equal(d.decision, "ask");
  assert.notEqual(d.source, "risk-experience"); // not an escalation, it was already ask
});

test("does NOT override explicit user trust allow", () => {
  const trustStore = { rules: [{ id: "t", tool: "edit", decision: "allow" }] };
  const d = pe.decide(writeMigrate, { autonomy: "gated", projectRules: esc, trustStore });
  assert.equal(d.decision, "allow");
  assert.equal(d.source, "user-trust-store");
});

test("escalate_only rule is never returned by the normal projectRules loop", () => {
  // even if it carries a (bogus) decision and would 'match', it must be ignored as a normal rule
  const sneaky = [{ escalate_only: true, cue: "anything", id: "r", decision: "deny", tool: "read" }];
  const d = pe.decide({ name: "read", category: "read", params: {} }, { autonomy: "gated", projectRules: sneaky });
  assert.equal(d.decision, "allow"); // read stays allow; the deny on the escalate_only rule is ignored
});

test("cue match against argv/command surface", () => {
  const d = pe.decide({ name: "shell", category: "execute", params: { argv: ["psql", "-f", "migrate.sql"] } }, { autonomy: "auto", projectRules: esc });
  assert.equal(d.decision, "ask"); // execute is allow under auto -> escalated to ask
});

test("destructive always deny regardless of risk rules", () => {
  const d = pe.decide({ name: "x", category: "destructive", params: { path: "migrate" } }, { autonomy: "gated", projectRules: esc });
  assert.equal(d.decision, "deny");
  assert.equal(d.source, "safety-invariant");
});

test("no risk rules => decide byte-identical to today", () => {
  const d = pe.decide(writeMigrate, { autonomy: "gated" });
  assert.equal(d.decision, "allow");
  assert.equal(d.source, "default-matrix");
});

test("riskRules maps cues; empty in => empty out", () => {
  assert.equal(riskRules(new Set(["a", "b"])).length, 2);
  assert.ok(riskRules(new Set(["A"]))[0].cue === "a"); // lowercased
  assert.deepEqual(riskRules(new Set()), []);
  assert.deepEqual(riskRules(), []);
});

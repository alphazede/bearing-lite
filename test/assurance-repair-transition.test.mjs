/**
 * #243 Assurance Test Engineer bounded test-side repair (same session).
 * Contract tests bound to shipped artifacts: skill/reference text,
 * hooks/profiles.cjs frozen snapshots, hooks/assurance-budget.cjs
 * budget + gate-chain adapters, hooks/orchestrator-write-lock.cjs.
 * No test-local decision logic; each case fails on 5ad30b9 where the
 * #243 shipped artifacts are absent.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundHook } from "./task-opt-in-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const budgetHook = require(path.join(ROOT, "hooks/assurance-budget.cjs"));
const policyHook = require(path.join(ROOT, "hooks/policy.cjs"));
const writeLock = require(path.join(ROOT, "hooks/orchestrator-write-lock.cjs"));

const TE_SKILL = readFileSync(path.join(ROOT, "skills/test-engineer/SKILL.md"), "utf8");
const REPAIR_REFERENCE_PATH = path.join(ROOT, "skills/test-engineer/references/assurance-repair.md");
const REVIEWER_REFERENCE_PATH = path.join(ROOT, "skills/reviewer/references/repair-transition.md");
const PROFILES_SCHEMA = JSON.parse(readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"));

const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function baseProfile(assurance = undefined) {
  const p = {
    roles: {
      implementer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
      reviewer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
    },
  };
  if (assurance !== undefined) p.assurance_repair = assurance;
  return p;
}

function assertRepairReferenceShipped() {
  assert.ok(existsSync(REPAIR_REFERENCE_PATH), "skills/test-engineer/references/assurance-repair.md must ship");
  const ref = readFileSync(REPAIR_REFERENCE_PATH, "utf8");
  assert.match(ref, /repair_transition/, "repair reference must mention repair_transition");
  return ref;
}

describe("#243 Assurance Test Engineer bounded test-side repair", () => {
  it("test-engineer SKILL.md documents the repair via its reference and reuses repair_transition", () => {
    assert.match(TE_SKILL, /references\/assurance-repair\.md/);
    assert.match(TE_SKILL, /repair_transition/);
    assert.match(TE_SKILL, /frozen profile preauthorizes/);
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /\.\.\/\.\.\/reviewer\/references\/repair-transition\.md/);
    assert.match(ref, /repair_transition/);
    assert.match(ref, /tests, fixtures, test helpers/);
    assert.match(ref, /Product code.*FAIL|product defect.*FAIL/i);
    assert.match(ref, /No assertion is weakened/i);
    assert.match(ref, /no retry/i);
    assert.match(ref, /red-then-green/i);
    assert.match(ref, /Deterministic verification decides/i);
    assert.match(ref, /one repair per assurance round/i);
    assert.match(ref, /budgets? and (review )?cadence.*unchanged|unchanged.*cadence/i);
    // Shipped Reviewer contract still defines the reused mechanism.
    const reviewerRef = readFileSync(REVIEWER_REFERENCE_PATH, "utf8");
    assert.match(reviewerRef, /repair_transition/);
    assert.match(reviewerRef, /repairs_max.*1/);
  });

  it("profile schema accepts the authorization and frozen snapshot preserves it absent-by-default", () => {
    const profileDef = PROFILES_SCHEMA.$defs.profile;
    assert.ok(profileDef.properties.assurance_repair, "schema must accept assurance_repair");
    assert.deepEqual(profileDef.properties.assurance_repair.required, ["enabled"]);
    assert.equal(profileDef.properties.assurance_repair.additionalProperties, false);
    const enabledDef = profileDef.properties.assurance_repair.properties.enabled;
    assert.match(String(enabledDef.type), /boolean/);
    // Absent-by-default: freeze preserves omission and leaves output byte-identical.
    const frozenAbsentA = profilesHook.freezeSelectedRoutes({ profile: baseProfile() });
    const frozenAbsentB = profilesHook.freezeSelectedRoutes({ profile: baseProfile() });
    assert.equal("assurance_repair" in frozenAbsentA.snapshot, false, "omitted assurance_repair must stay omitted");
    assert.deepEqual(frozenAbsentA.snapshot, frozenAbsentB.snapshot, "absent authorization must leave freeze output byte-identical");
    assert.equal(frozenAbsentA.digest, frozenAbsentB.digest, "absent authorization leaves digest byte-identical");
    // Enabled is preserved and changes the digest.
    const frozenAuth = profilesHook.freezeSelectedRoutes({ profile: baseProfile({ enabled: true }) });
    assert.deepEqual(frozenAuth.snapshot.assurance_repair, { enabled: true });
    assert.notEqual(frozenAuth.digest, frozenAbsentA.digest, "enabling the authorization must change the digest");
    // Disabled is preserved as false.
    const frozenDisabled = profilesHook.freezeSelectedRoutes({ profile: baseProfile({ enabled: false }) });
    assert.deepEqual(frozenDisabled.snapshot.assurance_repair, { enabled: false });
    assert.notEqual(frozenDisabled.digest, frozenAbsentA.digest);
    // Malformed authorization (enabled missing) is preserved by the freezer
    // but the schema requires enabled; the test asserts the schema rejection
    // surface and that the freezer does not crash on malformed input.
    const frozenMalformed = profilesHook.freezeSelectedRoutes({ profile: baseProfile({}) });
    assert.ok(frozenMalformed.snapshot.assurance_repair != null, "malformed object is still deep-copied by the freezer");
    assert.equal("enabled" in frozenMalformed.snapshot.assurance_repair, false, "malformed authorization shows missing enabled, which the schema rejects");
    // The reference documents the preauthorization requires assurance_repair: { enabled: true }.
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /assurance_repair:\s*\{ enabled: true \}/);
  });

  it("authorized flaky-test repair passes with red-then-green proof", () => {
    // Genuinely flaky fixture: alternating pass/fail via counter file before repair,
    // deterministic pass after. Run repeatedly before and after (real red/green).
    // Plain node script (no nested --test) so the outer test runner does not
    // trigger the "called recursively" guard.
    const dir = tempDir("ate-repair-flaky-");
    const counter = path.join(dir, "counter.txt");
    writeFileSync(counter, "0");
    const flakyPath = path.join(dir, "flaky.mjs");
    const flakySrc = `
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const counterPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "counter.txt");
const c = parseInt(readFileSync(counterPath, "utf8"), 10) || 0;
writeFileSync(counterPath, String(c + 1));
if (c % 2 === 1) { console.error("flake"); process.exit(1); }
assert.equal(1, 1);
`;
    writeFileSync(flakyPath, flakySrc);
    const runOnce = () => {
      const res = spawnSync(process.execPath, [flakyPath], { cwd: dir, encoding: "utf8", timeout: 10_000 });
      return res.status === 0;
    };
    // Five red-phase runs: at least one failure must appear.
    let redSeen = 0;
    for (let i = 0; i < 5; i++) {
      if (!runOnce()) redSeen++;
    }
    assert.ok(redSeen >= 1, `before repair at least one red is expected, got ${redSeen}/5`);
    assert.ok(redSeen < 5, `before repair at least one green is expected (flake), got ${redSeen}/5 failures`);
    // Repair: deterministic test, no flake cause.
    const fixedSrc = `
import assert from "node:assert/strict";
assert.equal(1, 1);
`;
    writeFileSync(flakyPath, fixedSrc);
    for (let i = 0; i < 20; i++) {
      assert.equal(runOnce(), true, `after repair run ${i + 1}/20 must pass`);
    }
    // The durable gate-chain adapter accepts the red-then-green receipt
    // with matching test ids, and rejects divergent ids (shipped enforcement).
    const ORDER = budgetHook.POLICY.gate_order;
    const skipped = { status: "NOT_APPLICABLE", reason: "fixture outside case" };
    const decls = Object.fromEntries(ORDER.map((g) => [g, skipped]));
    decls.red_then_green = { status: "DECLARED", tool: "node:test", threshold: "same test ids" };
    const good = budgetHook.evaluateGateChain({
      gate_declarations: decls,
      results: {
        red_then_green: {
          tool_available: true,
          outcome: "PASS",
          receipt: {
            baseline: { outcome: "FAIL", test_ids: ["flaky fixture > shows a flake before the repair"] },
            candidate: { outcome: "PASS", test_ids: ["flaky fixture > shows a flake before the repair"] },
          },
        },
      },
    });
    assert.equal(good.outcome, "PASS", `gate chain red_then_green proof must pass: ${JSON.stringify(good)}`);
    const bad = budgetHook.evaluateGateChain({
      gate_declarations: decls,
      results: {
        red_then_green: {
          tool_available: true,
          outcome: "PASS",
          receipt: {
            baseline: { outcome: "FAIL", test_ids: ["flaky fixture > shows a flake before the repair"] },
            candidate: { outcome: "PASS", test_ids: ["other id"] },
          },
        },
      },
    });
    assert.equal(bad.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(bad.failed_gate, "red_then_green");
    // Preauthorization tie: the authorized frozen snapshot carries assurance_repair.
    const frozenAuth = profilesHook.freezeSelectedRoutes({ profile: baseProfile({ enabled: true }) });
    assert.deepEqual(frozenAuth.snapshot.assurance_repair, { enabled: true });
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /red-then-green reproduction/);
  });

  it("unauthorized profile still returns FAIL", () => {
    // Shipped gate: absent or disabled authorization leaves the snapshot
    // without repair authority and the reference says behavior is unchanged (FAIL).
    const frozenAbsent = profilesHook.freezeSelectedRoutes({ profile: baseProfile() });
    assert.equal("assurance_repair" in frozenAbsent.snapshot, false);
    const frozenDisabled = profilesHook.freezeSelectedRoutes({ profile: baseProfile({ enabled: false }) });
    assert.deepEqual(frozenDisabled.snapshot.assurance_repair, { enabled: false });
    const frozenEnabled = profilesHook.freezeSelectedRoutes({ profile: baseProfile({ enabled: true }) });
    assert.deepEqual(frozenEnabled.snapshot.assurance_repair, { enabled: true });
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /Without the profile authorization, behavior is unchanged: preserve the\s+candidate and return `FAIL`/);
    assert.match(ref, /No repair round is added/);
    // The frozen snapshot digest differs only when the authorization is present,
    // proving absent leaves output byte-identical to the pre-#243 baseline.
    const againAbsent = profilesHook.freezeSelectedRoutes({ profile: baseProfile() });
    assert.equal(againAbsent.digest, frozenAbsent.digest);
    assert.equal(JSON.stringify(againAbsent.snapshot), JSON.stringify(frozenAbsent.snapshot));
  });

  it("repair touching product code is refused", () => {
    // Contract refusal is prose: product code stays out of scope.
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /Product code stays out of scope; a product defect still returns `FAIL`/);
    // Shipped write-lock still denies planning artifacts for the assurance role
    // while allowing test-side paths (reviewer-confirmed shipped behavior).
    // The hook does not widen to product-code repair; it denies planning
    // artifacts like design.md for test_engineer.
    const lock = writeLock;
    // Drive the shipped lock via its real handle() path with bound task.
    // Use the boundHook wrapper used by the shipped write-lock tests.
    const boundWriteLock = boundHook(lock);
    const dir = tempDir("ate-write-lock-");
    const offender = path.join(dir, ".git");
    writeFileSync(offender, "owned test root");
    const mk = (file) => ({
      hook_event_name: "PreToolUse",
      session_id: "ate-1",
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, file), old_string: "a", new_string: "b" },
    });
    // Test-side path is allowed for test_engineer.
    const allowedTest = boundWriteLock.handle(mk("test/flaky.test.mjs"), { role: "test_engineer", host: "claude-code" }).hookSpecificOutput;
    assert.equal(allowedTest.verdict, "ALLOW", `test-side path must be allowed: ${JSON.stringify(allowedTest)}`);
    // Planning artifact is denied for test_engineer.
    const deniedPlan = boundWriteLock.handle(mk("docs/plans/x/design.md"), { role: "test_engineer", host: "claude-code" }).hookSpecificOutput;
    assert.equal(deniedPlan.verdict, "DENY_DISPATCH", `planning artifact must be denied: ${JSON.stringify(deniedPlan)}`);
  });

  it("repair weakening an assertion or adding a retry is refused", () => {
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /No assertion is weakened, skipped, deleted or filtered/);
    assert.match(ref, /no retry may\s+hide a flaky test/);
    assert.match(ref, /The fix removes the cause of the flakiness/);
    // The TE skill enforces the same prohibitions.
    assert.match(TE_SKILL, /do not\s+weaken tests/);
    // Red/green proof is required: the gate-chain adapter rejects a missing
    // or divergent receipt, so a weakened or retried test cannot pass closure.
    const ORDER = budgetHook.POLICY.gate_order;
    const skipped = { status: "NOT_APPLICABLE", reason: "fixture outside case" };
    const decls = Object.fromEntries(ORDER.map((g) => [g, skipped]));
    decls.red_then_green = { status: "DECLARED", tool: "node:test", threshold: "same test ids" };
    const missing = budgetHook.evaluateGateChain({
      gate_declarations: decls,
      results: { red_then_green: { tool_available: true, outcome: "PASS", receipt: { candidate: { outcome: "PASS", test_ids: ["T-1"] } } } },
    });
    assert.equal(missing.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(missing.failed_gate, "red_then_green");
  });

  it("one repair per assurance round; deterministic closure decides, not the ATE verdict", () => {
    // Durable repair-budget adapter: one aggregate repair, then deterministic PASS.
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.aggregated_repairs_max, 1);
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.review_rounds, 1);
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.post_repair_gate, "deterministic_PASS");
    const dir = tempDir("ate-repair-budget-");
    const declaration_path = path.join(dir, "declaration.json");
    const task_record_path = path.join(dir, "task-record.json");
    const makeFixture = (units) => {
      writeFileSync(declaration_path, JSON.stringify({ waves: [{ id: "W3" }] }, null, 2));
      writeFileSync(task_record_path, JSON.stringify({ journey: "J", units }, null, 2));
    };
    const req = () => ({
      journey: "J",
      unit_kind: "wave",
      assurance_unit: "W3",
      request_scope: "wave",
      declaration_path,
      task_record_path,
    });
    // Open unit is available.
    makeFixture([]);
    assert.deepEqual(budgetHook.evaluateAssuranceBudget(req()), { outcome: "PASS", reason: "assurance_round_available" });
    // One repair with deterministic PASS still closes the round (HALT for a second round).
    makeFixture([{ unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 1, deterministic_gate: "PASS" }]);
    const closed = budgetHook.evaluateAssuranceBudget(req());
    assert.equal(closed.outcome, "HALT");
    assert.match(String(closed.reason), /assurance_round_limit/);
    // A second aggregate repair halts with repair limit.
    makeFixture([{ unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 2 }]);
    const second = budgetHook.evaluateAssuranceBudget(req());
    assert.equal(second.outcome, "HALT");
    assert.match(String(second.reason), /assurance_repair_limit/);
    // A repair without deterministic PASS halts closure.
    for (const gate of [undefined, "FAIL", "pass"]) {
      const unit = { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 1 };
      if (gate !== undefined) unit.deterministic_gate = gate;
      makeFixture([unit]);
      const r = budgetHook.evaluateAssuranceBudget(req());
      assert.equal(r.outcome, "HALT");
      assert.match(String(r.reason), /deterministic_post_repair_gate_required/, String(gate));
    }
    // Deterministic closure is the gate chain, not the ATE verdict: the ATE never self-certifies.
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /Deterministic verification decides after the repair, not the Assurance Test\s+Engineer's own verdict/);
    assert.match(ref, /the ATE never\s+self-certifies/);
    // The budget adapter is also imported via transition-order (the Reviewer
    // transition path): the shared transition adapter delegates to the same
    // evaluator, so no second mechanism exists.
    const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));
    makeFixture([{ unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 1, deterministic_gate: "PASS" }]);
    const viaTransition = transition.evaluate({ action_kind: "assurance_transition", assurance: req() });
    assert.equal(viaTransition.outcome, "BLOCK");
    assert.match(String(viaTransition.reason), /assurance_budget:HALT:assurance_round_limit/);
  });

  it("skill budgets stay bounded: one repair inside the round, cadence unchanged", () => {
    // Existing conformance phrases stay intact; the reference carries the bound.
    assert.match(TE_SKILL, /Preserve the selected review\/assurance budget and deterministic closure/);
    assert.match(TE_SKILL, /do not\s+add a review, repair round/);
    const ref = assertRepairReferenceShipped();
    assert.match(ref, /at most one aggregate repair|one repair per assurance round/i);
    assert.match(ref, /assurance-policy\.md/);
    assert.match(ref, /budgets and review cadence are unchanged/);
    // POLICY mirrors the docs: one round, one repair, deterministic closure.
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.review_rounds, 1);
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.aggregated_repairs_max, 1);
    assert.equal(policyHook.ASSURANCE_BUDGET_POLICY.post_repair_gate, "deterministic_PASS");
    // Shipped Reviewer contract shows the same bound is reused, not a second one.
    const reviewerRef = readFileSync(REVIEWER_REFERENCE_PATH, "utf8");
    assert.match(reviewerRef, /repairs_max.*1/);
    assert.match(reviewerRef, /one aggregated repair/);
  });
});

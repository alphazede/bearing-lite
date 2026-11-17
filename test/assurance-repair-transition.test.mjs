/**
 * #243 Assurance Test Engineer bounded test-side repair (same session).
 * Skill-text contract plus a local evaluator (no hook): profile-authorized
 * repair_transition reuse, test-side scope, no weakening/retry, red-then-green,
 * deterministic closure, one repair per round, unauthorized FAIL.
 * Mirrors test/reviewer-repair-transition.test.mjs; enforcement model is local.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));

const TE_SKILL = readFileSync(path.join(ROOT, "skills/test-engineer/SKILL.md"), "utf8");
const REPAIR_REFERENCE_PATH = path.join(ROOT, "skills/test-engineer/references/assurance-repair.md");
const REVIEWER_REFERENCE_PATH = path.join(ROOT, "skills/reviewer/references/repair-transition.md");
const PROFILES_SCHEMA = JSON.parse(readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"));

const TEST_SIDE_RE = /(^|\/)(test|tests|fixtures|helpers|conftest)(\/|$|\.)|(\.test\.|\.spec\.|_test\.|Test\.|fixtures?\/|helpers?\/)/i;
const TEST_CONFIG_RE = /(^|\/)(jest|vitest|mocha|pytest|phpunit|playwright|cypress)|\.(config|conf)\.(js|mjs|cjs|ts|json|ya?ml)$/i;

function isTestSidePath(p) {
  if (typeof p !== "string" || !p) return false;
  const n = p.replace(/\\/g, "/");
  return TEST_SIDE_RE.test(n) || TEST_CONFIG_RE.test(n);
}

function frozenReceipt(extra = {}) {
  return {
    candidate_ref: "c1",
    candidate_revision: "r1",
    candidate_digest: "d1",
    verdict: "FAIL",
    finding_ids: ["F1"],
    locations: { F1: "test/flaky.test.mjs:12" },
    reproducer: { F1: "node --test test/flaky.test.mjs x20 shows flake" },
    red_green: { F1: "5x red before, 20x green after" },
    repair_target: "test/flaky.test.mjs",
    write_set: ["test/flaky.test.mjs"],
    lineage: { worktree: "wt", branch: "main", generation: 1 },
    persisted: true,
    ...extra,
  };
}

const RECEIPT_FIELDS = Object.freeze([
  "candidate_ref", "candidate_revision", "candidate_digest",
  "verdict", "finding_ids", "locations", "reproducer",
  "red_green", "repair_target", "write_set",
]);

function deny(code, verdict = undefined) {
  return verdict ? { ok: false, code, verdict } : { ok: false, code };
}

function profileAuthorized(snapshot) {
  return !!(snapshot && snapshot.assurance_repair && snapshot.assurance_repair.enabled === true);
}

/**
 * Local contract for the approved ATE repair. Not a hook evaluator.
 * Authorized test-side repair reuses repair_transition; close is deterministic.
 */
function evaluateAssuranceRepair(ev) {
  const receipt = ev.receipt;
  const complete =
    receipt &&
    receipt.persisted === true &&
    RECEIPT_FIELDS.every((field) => receipt[field] != null && receipt[field] !== "");
  if (ev.mutate) {
    if (!profileAuthorized(ev.snapshot)) {
      return deny("profile_not_authorized", "FAIL");
    }
    if (ev.recorded_transition !== "repair_transition") {
      return deny("unrecorded_transition");
    }
    if (!complete) {
      return deny("frozen_receipt_required");
    }
    if ((ev.repairs_used || 0) >= 1) {
      return deny("one_repair_limit");
    }
    if (ev.red_green_proof !== true) {
      return deny("red_then_green_required");
    }
    const lineage = receipt.lineage;
    const want = ev.lineage;
    if (
      !want ||
      want.worktree !== lineage.worktree ||
      want.branch !== lineage.branch ||
      want.generation !== lineage.generation
    ) {
      return deny("lineage_mismatch");
    }
    const allowed = new Set(receipt.write_set);
    const writes = ev.writes || [];
    if (writes.some((p) => !allowed.has(p))) {
      return deny("write_set_exceeded");
    }
    if (writes.some((p) => !isTestSidePath(p))) {
      return deny("product_code_out_of_scope");
    }
    if (ev.weakens_assertion === true || ev.skips_assertion === true) {
      return deny("assertion_weakened");
    }
    if (ev.adds_retry === true) {
      return deny("retry_hides_flake");
    }
  }
  if (ev.close) {
    if (!profileAuthorized(ev.snapshot)) {
      return deny("profile_not_authorized", "FAIL");
    }
    if (ev.close_by !== "deterministic_PASS") {
      return deny("no_self_certification");
    }
  }
  return { ok: true, code: "allow" };
}

function authorizedSnapshot() {
  return { assurance_repair: { enabled: true } };
}

const allowedRepair = {
  snapshot: authorizedSnapshot(),
  recorded_transition: "repair_transition",
  repairs_used: 0,
  mutate: true,
  red_green_proof: true,
  receipt: frozenReceipt(),
  lineage: { worktree: "wt", branch: "main", generation: 1 },
  writes: ["test/flaky.test.mjs"],
};

describe("#243 Assurance Test Engineer bounded test-side repair", () => {
  it("test-engineer SKILL.md documents the repair via its reference and reuses repair_transition", () => {
    assert.match(TE_SKILL, /references\/assurance-repair\.md/);
    assert.match(TE_SKILL, /repair_transition/);
    assert.match(TE_SKILL, /frozen profile preauthorizes/);
    assert.ok(existsSync(REPAIR_REFERENCE_PATH), "skills/test-engineer/references/assurance-repair.md must ship");
    const ref = readFileSync(REPAIR_REFERENCE_PATH, "utf8");
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
  });

  it("profile schema accepts the authorization and frozen snapshot preserves it absent-by-default", () => {
    const profileDef = PROFILES_SCHEMA.$defs.profile;
    assert.ok(profileDef.properties.assurance_repair, "schema must accept assurance_repair");
    assert.deepEqual(profileDef.properties.assurance_repair.required, ["enabled"]);
    // Absent-by-default: base profile without the field validates and freezes without it.
    const base = {
      roles: {
        implementer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
        reviewer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
      },
    };
    const frozenAbsent = profilesHook.freezeSelectedRoutes({ profile: base });
    assert.equal("assurance_repair" in frozenAbsent.snapshot, false, "omitted assurance_repair must stay omitted");
    assert.equal(profileAuthorized(frozenAbsent.snapshot), false);
    const withAuth = JSON.parse(JSON.stringify(base));
    withAuth.assurance_repair = { enabled: true };
    const frozenAuth = profilesHook.freezeSelectedRoutes({ profile: withAuth });
    assert.deepEqual(frozenAuth.snapshot.assurance_repair, { enabled: true });
    assert.equal(profileAuthorized(frozenAuth.snapshot), true);
    assert.notEqual(frozenAuth.digest, frozenAbsent.digest, "enabling the authorization must change the digest");
    withAuth.assurance_repair.enabled = false;
    const frozenDisabled = profilesHook.freezeSelectedRoutes({ profile: withAuth });
    assert.equal(profileAuthorized(frozenDisabled.snapshot), false);
    assert.deepEqual(frozenDisabled.snapshot.assurance_repair, { enabled: false });
  });

  it("authorized flaky-test repair passes with red-then-green proof", () => {
    assert.equal(evaluateAssuranceRepair(allowedRepair).code, "allow");
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, mutate: false, close: true, close_by: "deterministic_PASS" }).code, "allow");
    assert.equal(evaluateAssuranceRepair(allowedRepair).verdict ?? "PASS", "PASS");
  });

  it("unauthorized profile still returns FAIL", () => {
    const base = {
      roles: {
        implementer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
        reviewer: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] },
      },
    };
    const frozenAbsent = profilesHook.freezeSelectedRoutes({ profile: base });
    const result = evaluateAssuranceRepair({ ...allowedRepair, snapshot: frozenAbsent.snapshot });
    assert.equal(result.ok, false);
    assert.equal(result.code, "profile_not_authorized");
    assert.equal(result.verdict, "FAIL");
    const disabled = evaluateAssuranceRepair({ ...allowedRepair, snapshot: { assurance_repair: { enabled: false } } });
    assert.equal(disabled.code, "profile_not_authorized");
    assert.equal(disabled.verdict, "FAIL");
  });

  it("repair touching product code is refused", () => {
    assert.equal(
      evaluateAssuranceRepair({
        ...allowedRepair,
        receipt: frozenReceipt({ write_set: ["src/app.js"], repair_target: "src/app.js" }),
        writes: ["src/app.js"],
      }).code,
      "product_code_out_of_scope"
    );
    assert.equal(
      evaluateAssuranceRepair({
        ...allowedRepair,
        receipt: frozenReceipt({ write_set: ["test/flaky.test.mjs", "src/app.js"] }),
        writes: ["src/app.js"],
      }).code,
      "product_code_out_of_scope"
    );
  });

  it("repair weakening an assertion or adding a retry is refused", () => {
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, weakens_assertion: true }).code, "assertion_weakened");
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, skips_assertion: true }).code, "assertion_weakened");
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, adds_retry: true }).code, "retry_hides_flake");
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, red_green_proof: false }).code, "red_then_green_required");
  });

  it("one repair per assurance round; deterministic closure decides, not the ATE verdict", () => {
    assert.equal(evaluateAssuranceRepair({ ...allowedRepair, repairs_used: 1 }).code, "one_repair_limit");
    assert.equal(
      evaluateAssuranceRepair({ ...allowedRepair, mutate: false, close: true, close_by: "ate_PASS" }).code,
      "no_self_certification"
    );
    assert.equal(
      evaluateAssuranceRepair({ ...allowedRepair, mutate: false, close: true, close_by: "self_review" }).code,
      "no_self_certification"
    );
    assert.equal(
      evaluateAssuranceRepair({ ...allowedRepair, recorded_transition: null }).code,
      "unrecorded_transition"
    );
    assert.equal(
      evaluateAssuranceRepair({ ...allowedRepair, mutate: false, close: true, close_by: "deterministic_PASS" }).code,
      "allow"
    );
  });

  it("skill budgets stay bounded: one repair inside the round, cadence unchanged", () => {
    // Existing conformance phrases stay intact; the reference carries the bound.
    assert.match(TE_SKILL, /Preserve the selected review\/assurance budget and deterministic closure/);
    assert.match(TE_SKILL, /do not\s+add a review, repair round/);
    const ref = readFileSync(REPAIR_REFERENCE_PATH, "utf8");
    assert.match(ref, /at most one aggregate repair|one repair per assurance round/i);
    assert.match(ref, /assurance-policy\.md/);
  });
});

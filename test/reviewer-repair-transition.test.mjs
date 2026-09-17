/**
 * #116 bounded Reviewer → Repair Implementer transition.
 * Skill-text contract plus a local evaluator (no hook): frozen receipt
 * before mutation, lineage/write-set limits, no self-certification,
 * one-repair budget, dispatch fallback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWER = readFileSync(path.join(ROOT, "skills/reviewer/SKILL.md"), "utf8");
const IMPLEMENTER = readFileSync(path.join(ROOT, "skills/implementer/SKILL.md"), "utf8");
const REVIEW_POLICY = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/review-policy.md"),
  "utf8"
);
const ROUTER = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");

const RECEIPT_FIELDS = Object.freeze([
  "candidate_ref",
  "candidate_revision",
  "candidate_digest",
  "verdict",
  "finding_ids",
  "severity",
  "locations",
  "reachability",
  "reproducer",
  "seit_refs",
  "repair_target",
  "write_set",
]);

function frozenReceipt(extra = {}) {
  return {
    candidate_ref: "c1",
    candidate_revision: "r1",
    candidate_digest: "d1",
    verdict: "REPAIR_REQUIRED",
    finding_ids: ["F1"],
    severity: { F1: "P1" },
    locations: { F1: "src/a.js:4" },
    reachability: { F1: "reachable" },
    reproducer: { F1: "node --test test/a.test.mjs" },
    seit_refs: { F1: "SEIT-1" },
    repair_target: "src/a.js",
    write_set: ["src/a.js"],
    lineage: { worktree: "wt", branch: "main", generation: 1 },
    persisted: true,
    ...extra,
  };
}

function deny(code) {
  return { ok: false, code };
}

/**
 * Local contract for the approved transition. Not a hook evaluator.
 * @param {Record<string, unknown>} ev
 */
function evaluateRepairTransition(ev) {
  const receipt = ev.receipt;
  const complete =
    receipt &&
    receipt.persisted === true &&
    RECEIPT_FIELDS.every((field) => receipt[field] != null && receipt[field] !== "");

  if (ev.authority === "reviewer" && ev.mutate) {
    return deny("reviewer_must_not_mutate");
  }
  if (ev.mutate && !complete) {
    return deny("frozen_receipt_required");
  }
  if (ev.mutate) {
    if (ev.parent_accepted !== "REPAIR_REQUIRED") {
      return deny("parent_accept_required");
    }
    if (ev.authority !== "repair_implementer" || ev.recorded_transition !== "repair_implementer") {
      return deny("unrecorded_transition");
    }
    if (ev.preserve_session !== true) {
      return deny("dispatch_fallback");
    }
    if ((ev.repairs_used || 0) >= 1) {
      return deny("one_repair_limit");
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
    const frozen = new Set(receipt.finding_ids);
    const findings = ev.findings || [];
    if (findings.some((id) => !frozen.has(id))) {
      return deny("finding_outside_receipt");
    }
    if (ev.refactor || ev.scope_expansion || ev.owner_only) {
      return deny("scope_expansion");
    }
  }
  if (ev.close) {
    if (ev.close_by !== "deterministic_PASS") {
      return deny("no_self_certification");
    }
    if (ev.failed || ev.scope_expansion || ev.new_design_issue) {
      return deny("owner_authority");
    }
    const frozen = new Set((receipt && receipt.finding_ids) || []);
    if ((ev.new_defects || []).some((id) => !frozen.has(id))) {
      return deny("owner_authority");
    }
  }
  return { ok: true, code: "allow" };
}

const allowedRepair = {
  authority: "repair_implementer",
  recorded_transition: "repair_implementer",
  parent_accepted: "REPAIR_REQUIRED",
  preserve_session: true,
  repairs_used: 0,
  mutate: true,
  receipt: frozenReceipt(),
  lineage: { worktree: "wt", branch: "main", generation: 1 },
  writes: ["src/a.js"],
  findings: ["F1"],
};

describe("#116 Reviewer to Repair Implementer transition", () => {
  it("planning review-policy.md does not own this transition", () => {
    assert.match(REVIEW_POLICY, /Planning and Design writes the separate Lifecycle binding/);
    assert.match(REVIEW_POLICY, /Implementation assurance remains governed separately/);
    assert.doesNotMatch(REVIEW_POLICY, /Repair Implementer/);
    assert.doesNotMatch(REVIEW_POLICY, /frozen review receipt/);
  });

  it("standing one-repair / no-rereview budget is unchanged", () => {
    assert.match(ROUTER, /`max_assurance_rounds` is\s+1 per declared phase or wave-end/);
    assert.match(ROUTER, /one review may authorize\s+one repair/);
    assert.match(ROUTER, /without another review/);
    assert.match(REVIEWER, /max_assurance_rounds/);
    assert.match(REVIEWER, /of 1/);
    assert.match(REVIEWER, /without another review/);
  });

  it("rule 1: Reviewer never edits; frozen receipt is required before mutation", () => {
    assert.match(REVIEWER, /While Reviewer,\s+never edit/);
    assert.match(REVIEWER, /persist a frozen receipt first/);
    assert.match(REVIEWER, /ref\/revision\/digest/);
    assert.match(REVIEWER, /finding IDs/);
    assert.match(REVIEWER, /write set/);
    assert.equal(evaluateRepairTransition({ authority: "reviewer", mutate: true, receipt: frozenReceipt() }).code, "reviewer_must_not_mutate");
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, receipt: frozenReceipt({ persisted: false }) }).code,
      "frozen_receipt_required"
    );
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, receipt: frozenReceipt({ finding_ids: null }) }).code,
      "frozen_receipt_required"
    );
  });

  it("rule 2: parent-accepted REPAIR_REQUIRED, explicit Repair Implementer, lineage and write set", () => {
    assert.match(REVIEWER, /parent-accepted `REPAIR_REQUIRED`/i);
    assert.match(REVIEWER, /explicit Repair Implementer transition/);
    assert.match(REVIEWER, /same lineage/);
    assert.match(IMPLEMENTER, /frozen review receipt/);
    assert.match(IMPLEMENTER, /parent-accepted `REPAIR_REQUIRED`/);
    assert.match(IMPLEMENTER, /worktree\/branch\/generation/);
    assert.match(IMPLEMENTER, /write set/);
    assert.equal(evaluateRepairTransition(allowedRepair).code, "allow");
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, parent_accepted: "ACCEPT" }).code,
      "parent_accept_required"
    );
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, recorded_transition: null }).code,
      "unrecorded_transition"
    );
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        lineage: { worktree: "other", branch: "main", generation: 1 },
      }).code,
      "lineage_mismatch"
    );
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, writes: ["src/a.js", "src/b.js"] }).code,
      "write_set_exceeded"
    );
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, findings: ["F1", "F2"] }).code,
      "finding_outside_receipt"
    );
    assert.equal(evaluateRepairTransition({ ...allowedRepair, refactor: true }).code, "scope_expansion");
  });

  it("rule 3: preserve context or fall back to dispatch", () => {
    assert.match(REVIEWER, /Preserve context|preserve(?:d)? loaded context/i);
    assert.match(REVIEWER, /dispatch/);
    assert.match(IMPLEMENTER, /dispatch if\s+session cannot be preserved/);
    assert.equal(
      evaluateRepairTransition({ ...allowedRepair, preserve_session: false }).code,
      "dispatch_fallback"
    );
  });

  it("rule 4: no self-certification; deterministic close; escalate failed repair", () => {
    assert.match(REVIEWER, /deterministic verification/);
    assert.match(REVIEWER, /Never self-review/);
    assert.match(IMPLEMENTER, /deterministic verification/);
    assert.match(IMPLEMENTER, /no extra review/);
    assert.match(IMPLEMENTER, /self-certify/);
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        mutate: false,
        close: true,
        close_by: "self_review",
      }).code,
      "no_self_certification"
    );
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        mutate: false,
        close: true,
        close_by: "additional_review",
      }).code,
      "no_self_certification"
    );
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        mutate: false,
        close: true,
        close_by: "deterministic_PASS",
      }).code,
      "allow"
    );
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        mutate: false,
        close: true,
        close_by: "deterministic_PASS",
        failed: true,
      }).code,
      "owner_authority"
    );
  });

  it("rule 5: one repair; defects outside the frozen receipt escalate", () => {
    assert.match(REVIEWER, /permits one repair/);
    assert.match(REVIEWER, /outside the frozen receipt/);
    assert.match(IMPLEMENTER, /One repair/);
    assert.equal(evaluateRepairTransition({ ...allowedRepair, repairs_used: 1 }).code, "one_repair_limit");
    assert.equal(
      evaluateRepairTransition({
        ...allowedRepair,
        mutate: false,
        close: true,
        close_by: "deterministic_PASS",
        new_defects: ["F-new"],
      }).code,
      "owner_authority"
    );
  });
});

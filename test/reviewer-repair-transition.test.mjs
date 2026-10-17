/**
 * #116 bounded Reviewer → Repair Implementer transition.
 * Skill-text contract plus a local evaluator (no hook): frozen receipt
 * before mutation, lineage/write-set limits, no self-certification,
 * one-repair budget, dispatch fallback.
 * #201 parent-admitted late findings inside the same open repair round.
 * #206: this file's evaluator is a local contract model only. The shipped
 * write lock's enforcement of the recorded transition is proven against the
 * real hook adapters in test/reviewer-repair-write-lock.test.mjs.
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
    const late = ev.addendum ? lateFindingCheck(ev, receipt) : null;
    if (late) {
      return late;
    }
    // An admitted addendum continues the open round; it is not a new repair.
    if (!ev.addendum && (ev.repairs_used || 0) >= 1) {
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
    const frozen = new Set([...receipt.finding_ids, ...admittedIds(ev)]);
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
    const late = ev.addendum ? lateFindingCheck(ev, receipt || {}, { closing: true }) : null;
    if (late) {
      return late;
    }
    const frozen = new Set([...((receipt && receipt.finding_ids) || []), ...admittedIds(ev)]);
    if ((ev.new_defects || []).some((id) => !frozen.has(id))) {
      return deny("owner_authority");
    }
    if ((ev.unfixed_accepted || []).length > 0) {
      return deny("accepted_fixable_finding_remaining");
    }
  }
  return { ok: true, code: "allow" };
}


function admittedIds(ev) {
  const a = ev.addendum;
  return a && a.parent_admitted === true && a.reproduced === true ? a.finding_ids : [];
}

/**
 * #201 local model: a late finding joins the SAME open repair round only as a
 * frozen addendum the parent admitted. Not a hook; no runtime claim.
 */
function lateFindingCheck(ev, receipt, { closing = false } = {}) {
  const a = ev.addendum;
  const round = ev.round;
  if (ev.second_review || ev.budget_reset) {
    return deny("no_second_review_or_reset");
  }
  if (!round || round.open !== true) {
    return deny("repair_round_closed");
  }
  if (ev.original_receipt_digest !== receipt.candidate_digest || a.edits_original_receipt) {
    return deny("original_receipt_immutable");
  }
  if (a.frozen !== true) {
    return deny("addendum_not_frozen");
  }
  if (a.reproduced !== true) {
    return deny("addendum_reproduction_required");
  }
  if (a.parent_admitted !== true) {
    return deny("parent_admission_required");
  }
  const allowed = new Set(receipt.write_set);
  if ((a.paths || []).some((p) => !allowed.has(p))) {
    return deny("addendum_out_of_scope");
  }
  if (a.contract_changed || a.protected_action) {
    return deny("contract_or_protected_change");
  }
  if (ev.session !== round.session) {
    return deny("session_mismatch");
  }
  const allowance = round.correction_allowance;
  if (!allowance || typeof allowance.limit !== "number" || typeof allowance.used !== "number") {
    return deny("correction_allowance_missing");
  }
  // Exhaustion stops a new correction, not closure after the last one.
  if (!closing && allowance.used >= allowance.limit) {
    return deny("correction_allowance_exhausted");
  }
  return null;
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

  describe("#201 parent-admitted late findings in the same open repair", () => {
    const openRound = {
      open: true,
      session: "rev-s1",
      correction_allowance: { limit: 3, used: 1 },
    };
    const addendum = {
      finding_ids: ["F2"],
      frozen: true,
      reproduced: true,
      parent_admitted: true,
      paths: ["src/a.js"],
    };
    const late = {
      ...allowedRepair,
      repairs_used: 1,
      round: openRound,
      session: "rev-s1",
      original_receipt_digest: "d1",
      addendum,
      findings: ["F1", "F2"],
    };
    const code = (ev) => evaluateRepairTransition(ev).code;

    it("skill text: open round, frozen addendum, parent admission and allowance", () => {
      assert.match(REVIEWER, /repair round open through final\s+deterministic verification/i);
      assert.match(REVIEWER, /freeze an addendum/i);
      assert.match(REVIEWER, /do not silently edit the receipt/i);
      assert.match(REVIEWER, /same round only after reproducing/i);
      assert.match(REVIEWER, /approved paths/i);
      assert.match(REVIEWER, /unchanged contract and protected boundaries/i);
      assert.match(REVIEWER, /remaining\s+recorded correction allowance/i);
      assert.doesNotMatch(REVIEWER, /at most three/i);
      assert.match(REVIEWER, /age alone does not justify/i);
      assert.match(REVIEWER, /same reviewer session repairs only accepted finding IDs/i);
      assert.match(REVIEWER, /red\/green regression evidence/i);
      assert.match(REVIEWER, /No second review/);
      assert.match(REVIEWER, /no accepted\s+fixable finding remains/i);
      assert.match(REVIEWER, /exhausted allowance/i);
      assert.match(REVIEWER, /reopen a closed round/i);
      assert.match(REVIEWER, /Never reset\s+budgets/i);
    });

    it("valid parent-admitted addendum continues the open round", () => {
      assert.equal(code(late), "allow");
      assert.equal(code({ ...late, findings: ["F2"] }), "allow");
    });

    it("original accepted finding stays compatible; new repair still limited", () => {
      assert.equal(code(allowedRepair), "allow");
      assert.equal(code({ ...allowedRepair, repairs_used: 1 }), "one_repair_limit");
      assert.equal(
        code({ ...allowedRepair, findings: ["F1", "F2"] }),
        "finding_outside_receipt"
      );
    });

    it("missing reproduction, freeze or parent admission is denied", () => {
      assert.equal(code({ ...late, addendum: { ...addendum, reproduced: false } }), "addendum_reproduction_required");
      assert.equal(code({ ...late, addendum: { ...addendum, frozen: false } }), "addendum_not_frozen");
      assert.equal(code({ ...late, addendum: { ...addendum, parent_admitted: false } }), "parent_admission_required");
    });

    it("out-of-scope paths, contract change or protected action are denied", () => {
      assert.equal(code({ ...late, addendum: { ...addendum, paths: ["src/b.js"] } }), "addendum_out_of_scope");
      assert.equal(code({ ...late, addendum: { ...addendum, contract_changed: true } }), "contract_or_protected_change");
      assert.equal(code({ ...late, addendum: { ...addendum, protected_action: true } }), "contract_or_protected_change");
    });

    it("missing or exhausted allowance is not granted; the recorded limit is the only cap", () => {
      assert.equal(code({ ...late, round: { ...openRound, correction_allowance: undefined } }), "correction_allowance_missing");
      assert.equal(code({ ...late, round: { ...openRound, correction_allowance: { used: 0 } } }), "correction_allowance_missing");
      assert.equal(code({ ...late, round: { ...openRound, correction_allowance: { limit: 3, used: 3 } } }), "correction_allowance_exhausted");
      assert.notEqual(code({ ...late, round: { ...openRound, correction_allowance: { limit: 9, used: 3 } } }), "correction_allowance_exhausted");
      assert.equal(code({ ...late, round: { ...openRound, correction_allowance: { limit: 1, used: 1 } } }), "correction_allowance_exhausted");
    });

    it("closed round, second review, budget reset, other session or lineage are denied", () => {
      assert.equal(code({ ...late, round: { ...openRound, open: false } }), "repair_round_closed");
      assert.equal(code({ ...late, round: undefined }), "repair_round_closed");
      assert.equal(code({ ...late, second_review: true }), "no_second_review_or_reset");
      assert.equal(code({ ...late, budget_reset: true }), "no_second_review_or_reset");
      assert.equal(code({ ...late, session: "rev-s2" }), "session_mismatch");
      assert.equal(
        code({ ...late, lineage: { worktree: "wt", branch: "main", generation: 2 } }),
        "lineage_mismatch"
      );
    });

    it("original receipt is immutable", () => {
      assert.equal(code({ ...late, original_receipt_digest: "d0" }), "original_receipt_immutable");
      assert.equal(code({ ...late, addendum: { ...addendum, edits_original_receipt: true } }), "original_receipt_immutable");
    });

    it("close: deterministic only; age is no exemption for an accepted fixable finding", () => {
      const close = { ...late, mutate: false, close: true, close_by: "deterministic_PASS" };
      assert.equal(code({ ...close, new_defects: ["F2"] }), "allow");
      assert.equal(code({ ...close, unfixed_accepted: ["F2"], left_open_reason: "baseline_age" }), "accepted_fixable_finding_remaining");
      assert.equal(code({ ...close, close_by: "self_review" }), "no_self_certification");
      assert.equal(code({ ...close, new_defects: ["F3"] }), "owner_authority");
    });

    it("close: an addendum that fails admission cannot close the round", () => {
      const close = { ...late, mutate: false, close: true, close_by: "deterministic_PASS", new_defects: ["F2"] };
      const bad = (extra) => code({ ...close, addendum: { ...addendum, ...extra } });
      assert.equal(bad({ frozen: false }), "addendum_not_frozen");
      assert.equal(bad({ reproduced: false }), "addendum_reproduction_required");
      assert.equal(bad({ parent_admitted: false }), "parent_admission_required");
      assert.equal(bad({ paths: ["src/b.js"] }), "addendum_out_of_scope");
      assert.equal(bad({ contract_changed: true }), "contract_or_protected_change");
      assert.equal(bad({ protected_action: true }), "contract_or_protected_change");
      assert.equal(bad({ edits_original_receipt: true }), "original_receipt_immutable");
      assert.equal(code({ ...close, round: { ...openRound, open: false } }), "repair_round_closed");
      assert.equal(code({ ...close, round: { ...openRound, correction_allowance: undefined } }), "correction_allowance_missing");
      assert.equal(code({ ...close, session: "rev-s2" }), "session_mismatch");
      // Closing after the last allowed correction is valid; exhaustion only stops new corrections.
      assert.equal(code({ ...close, round: { ...openRound, correction_allowance: { limit: 3, used: 3 } } }), "allow");
    });
  });
});

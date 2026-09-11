"use strict";

const { PLANNING_REVIEW_POLICY: POLICY } = require("./policy.cjs");

const sameCandidate = (a, b) =>
  POLICY.candidate_fields.every(
    (key) => typeof a?.[key] === "string" && a[key] && a[key] === b?.[key]
  );

function evaluatePlanningReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_review_missing" };
  }
  const slots = Array.isArray(input.reviewer_slots) ? input.reviewer_slots : [];
  const ids = slots.map((slot) => slot?.slot_id);
  const primaryRoutes = slots.map((slot) => slot?.primary_route_ref);
  if (
    slots.length < POLICY.reviewer_slots_min ||
    slots.length > POLICY.reviewer_slots_max ||
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length ||
    new Set(primaryRoutes).size !== primaryRoutes.length ||
    slots.some(
      (slot) =>
        typeof slot.primary_route_ref !== "string" ||
        !slot.primary_route_ref ||
        !Array.isArray(slot.fallback_route_refs)
    )
  ) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "slot_binding_invalid" };
  }
  if (slots.some((slot) => slot.exhausted === true)) {
    return { outcome: POLICY.slot_exhaustion_outcome, reason: "reviewer_slot_exhausted" };
  }
  if (input.round_number !== 1 || input.completed_rounds > POLICY.review_rounds) {
    return { outcome: "HALT", reason: "review_round_limit" };
  }
  if (input.completed_rounds === 0) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "review_round_pending" };
  }
  if (input.completed_rounds !== POLICY.review_rounds) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "review_round_invalid" };
  }
  if (
    POLICY.automatic_rereview === "prohibited" &&
    (input.automatic_rereview_requested === true || input.review_after_repair === true)
  ) {
    return { outcome: "OWNER_AMENDMENT_REQUIRED", reason: "automatic_rereview_prohibited" };
  }
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const receiptIds = receipts.map((receipt) => receipt?.slot_id);
  const selectedRoutes = receipts.map((receipt) => receipt?.selected_route_ref);
  if (
    receipts.length !== slots.length ||
    new Set(receiptIds).size !== receiptIds.length ||
    new Set(selectedRoutes).size !== selectedRoutes.length ||
    !input.candidate ||
    receipts.some(
      (receipt) => {
        const slot = slots.find((item) => item.slot_id === receipt?.slot_id);
        return (
          !slot ||
          ![slot.primary_route_ref, ...slot.fallback_route_refs].includes(receipt.selected_route_ref) ||
          receipt.independent !== POLICY.independence_required ||
          receipt.findings_isolated !== POLICY.isolated_findings_until_aggregation ||
          !sameCandidate(receipt, input.candidate)
        );
      }
    )
  ) {
    return { outcome: "HALT", reason: "candidate_or_independence_mismatch" };
  }
  if (input.aggregation_complete !== true) {
    return { outcome: "NEEDS_MORE_EVIDENCE", reason: "aggregation_pending" };
  }
  const repairs = Number(input.aggregated_repairs || 0);
  if (!Number.isInteger(repairs) || repairs < 0 || repairs > POLICY.aggregated_repairs_max) {
    return { outcome: "HALT", reason: "aggregated_repair_limit" };
  }
  if (repairs === 1 && input.deterministic_gate !== POLICY.post_repair_gate.split("_")[1]) {
    return { outcome: "HALT", reason: "deterministic_post_repair_gate_required" };
  }
  return { outcome: "PASS", reason: repairs ? "repair_gate_passed" : "review_aggregated" };
}

module.exports = { POLICY, evaluatePlanningReview };

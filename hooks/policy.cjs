"use strict";

/**
 * Single policy source for the planning-review and assurance-budget
 * evaluators (#63). The JSON blocks in
 * skills/bearing-lite/references/review-policy.md and assurance-policy.md
 * must equal these objects; test/policy-drift.test.mjs enforces it.
 */

const PLANNING_REVIEW_POLICY = Object.freeze({
  reviewer_slots_min: 2,
  reviewer_slots_max: 2,
  independence_required: true,
  isolated_findings_until_aggregation: true,
  candidate_fields: ["candidate_ref", "candidate_revision", "candidate_digest"],
  shared_candidate_required: true,
  review_rounds: 1,
  aggregated_repairs_max: 1,
  post_repair_gate: "deterministic_PASS",
  automatic_rereview: "prohibited",
  slot_exhaustion_outcome: "FAIL_ROUND",
  terminal_outcomes: ["HALT", "OWNER_AMENDMENT_REQUIRED"],
});

const ASSURANCE_BUDGET_POLICY = Object.freeze({
  budget_scope: "per_declared_phase_or_wave",
  review_rounds: 1,
  aggregated_repairs_max: 1,
  post_repair_gate: "deterministic_PASS",
  automatic_phase_or_wave_end_review: "required",
  automatic_per_slice_review: "prohibited",
  post_repair_rereview: "prohibited",
  automatic_rereview_of_same_unit: "prohibited",
  budget_reset_on_candidate_change: false,
  budget_reset_on_model_change: false,
  budget_reset_on_harness_change: false,
  budget_reset_on_role_change: false,
  budget_reset_on_session_change: false,
  budget_reset_on_resume: false,
  budget_reset_on_alias_or_rename: false,
  budget_reset_condition:
    "next_distinct_declared_phase_or_wave_present_in_the_frozen_declaration",
});

module.exports = { PLANNING_REVIEW_POLICY, ASSURANCE_BUDGET_POLICY };

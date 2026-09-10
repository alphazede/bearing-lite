"use strict";

/**
 * Per-declared-phase-or-wave assurance budget (ROUTER-EMV-CADENCE-IMPLEMENTATION-001).
 * Exact runtime mirror of `skills/bearing-lite/references/assurance-policy.md`.
 * A pure evaluator behind the existing `transition` class, like planning-review.cjs:
 * it declares no HOOK_CLASS and registers no host event.
 */

const fs = require("node:fs");

const POLICY = Object.freeze({
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

/** The sentinel unit when the frozen declaration names neither waves nor phases. */
const DIRECT = "direct";
const PENDING_RECEIPTS = new Set(["WAITING_ON", "UNAVAILABLE"]);

const isCount = (value) => Number.isInteger(value) && value >= 0;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function readJson(file) {
  if (typeof file !== "string" || !file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Declared unit ids from the frozen declaration, in declaration order. */
function declaredUnits(declaration) {
  const waves = Array.isArray(declaration.waves) ? declaration.waves : [];
  const waveIds = waves.map((wave) => wave && wave.id).filter((id) => typeof id === "string" && id);
  if (waveIds.length) return waveIds;
  const phases = Array.isArray(declaration.phases) ? declaration.phases : [];
  const phaseIds = phases
    .map((phase) => phase && phase.phaseId)
    .filter((id) => typeof id === "string" && id);
  if (phaseIds.length) return phaseIds;
  return [DIRECT];
}

const verdict = (outcome, reason) => ({ outcome, reason });

/**
 * @param {unknown} input assurance request
 * @returns {{ outcome: string, reason: string }}
 */
function evaluateAssuranceBudget(input) {
  try {
    if (!isPlainObject(input)) {
      return verdict("NEEDS_MORE_EVIDENCE", "assurance_request_missing");
    }
    if (
      POLICY.automatic_per_slice_review === "prohibited" &&
      (input.request_scope === "slice" || input.unit_kind === "slice")
    ) {
      return verdict("OWNER_AMENDMENT_REQUIRED", "automatic_per_slice_review_prohibited");
    }
    if (
      POLICY.automatic_rereview_of_same_unit === "prohibited" &&
      (input.automatic_rereview_requested === true || input.review_after_repair === true)
    ) {
      return verdict("OWNER_AMENDMENT_REQUIRED", "automatic_rereview_prohibited");
    }

    const declaration = readJson(input.declaration_path);
    if (!declaration) {
      return verdict("NEEDS_MORE_EVIDENCE", "frozen_declaration_unreadable");
    }
    const record = readJson(input.task_record_path);
    if (!record) {
      return verdict("NEEDS_MORE_EVIDENCE", "task_record_unreadable");
    }
    // The budget key is `journey + unit_kind + unit_id`; a record from another
    // Journey never answers for this one.
    if (
      typeof record.journey === "string" &&
      typeof input.journey === "string" &&
      record.journey !== input.journey
    ) {
      return verdict("NEEDS_MORE_EVIDENCE", "task_record_journey_mismatch");
    }

    const declared = declaredUnits(declaration);
    const requested =
      typeof input.assurance_unit === "string" && input.assurance_unit
        ? input.assurance_unit
        : declared.length === 1 && declared[0] === DIRECT
          ? DIRECT
          : "";
    if (!requested || !declared.includes(requested)) {
      return verdict("OWNER_AMENDMENT_REQUIRED", "undeclared_review_unit");
    }

    const receipts = Array.isArray(input.receipts) ? input.receipts : [];
    if (receipts.some((receipt) => PENDING_RECEIPTS.has(receipt && receipt.verdict))) {
      return verdict("NEEDS_MORE_EVIDENCE", "assurance_transport_pending");
    }

    const units = Array.isArray(record.units) ? record.units : [];
    const spent = units.find((unit) => {
      if (!isPlainObject(unit)) return false;
      const unitId = unit.unit_id || unit.assurance_unit;
      const id = typeof unitId === "string" && unitId ? unitId : DIRECT;
      if (id !== requested) return false;
      if (typeof unit.journey === "string" && unit.journey !== input.journey) return false;
      if (
        typeof unit.unit_kind === "string" &&
        typeof input.unit_kind === "string" &&
        unit.unit_kind !== input.unit_kind
      ) {
        return false;
      }
      return true;
    });
    const counter = (field) => {
      const value = spent && spent[field];
      return value === undefined || value === null ? 0 : value;
    };
    const rounds = counter("assurance_rounds");
    const repairs = counter("assurance_repairs");
    // A corrupt counter is not a spent-zero budget.
    if (!isCount(rounds) || !isCount(repairs)) {
      return verdict("NEEDS_MORE_EVIDENCE", "invalid_assurance_counter");
    }

    if (repairs > POLICY.aggregated_repairs_max) {
      return verdict("HALT", "assurance_repair_limit");
    }
    if (
      repairs === POLICY.aggregated_repairs_max &&
      (spent && spent.deterministic_gate) !== POLICY.post_repair_gate.split("_")[1]
    ) {
      return verdict("HALT", "deterministic_post_repair_gate_required");
    }
    if (rounds >= POLICY.review_rounds) {
      return verdict("HALT", "assurance_round_limit");
    }
    return verdict("PASS", "assurance_round_available");
  } catch {
    return verdict("NEEDS_MORE_EVIDENCE", "assurance_budget_unavailable");
  }
}

module.exports = { POLICY, evaluateAssuranceBudget };

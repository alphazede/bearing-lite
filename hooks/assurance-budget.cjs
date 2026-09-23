"use strict";

/**
 * Per-declared-cadence-unit assurance budget (ROUTER-EMV-CADENCE-IMPLEMENTATION-001).
 * Exact runtime mirror of `skills/bearing-lite/references/assurance-policy.md`.
 * A pure evaluator behind the existing `transition` class, like planning-review.cjs:
 * it declares no HOOK_CLASS and registers no host event.
 */

const fs = require("node:fs");

const { ASSURANCE_BUDGET_POLICY: POLICY } = require("./policy.cjs");

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

function idsFrom(list, key) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => item && item[key]).filter((id) => typeof id === "string" && id);
}

function lifecycleId(declaration) {
  const settings = isPlainObject(declaration.journey_settings) ? declaration.journey_settings : {};
  if (typeof settings.lifecycle_id === "string" && settings.lifecycle_id) return settings.lifecycle_id;
  if (typeof declaration.lifecycle_id === "string" && declaration.lifecycle_id) {
    return declaration.lifecycle_id;
  }
  if (typeof declaration.journey === "string" && declaration.journey) return declaration.journey;
  if (isPlainObject(declaration.journey) && typeof declaration.journey.id === "string" && declaration.journey.id) {
    return declaration.journey.id;
  }
  return "";
}

/** Declared unit ids from the frozen declaration, in declaration order. */
function declaredUnits(declaration, unitKind) {
  if (unitKind === "slice") return idsFrom(declaration.slices, "id");
  if (unitKind === "lifecycle") {
    const id = lifecycleId(declaration);
    return id ? [id] : [];
  }
  const waveIds = idsFrom(declaration.waves, "id");
  if (waveIds.length) return waveIds;
  const phaseIds = idsFrom(declaration.phases, "phaseId");
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
    const sliceRequested = input.request_scope === "slice" || input.unit_kind === "slice";
    const cadence = typeof input.cadence === "string" ? input.cadence : POLICY.default_cadence?.["test_engineer.assurance"] || "phase";
    if (
      sliceRequested &&
      (POLICY.automatic_per_slice_review === "prohibited" ||
        (POLICY.automatic_per_slice_review === "cadence_gated" && cadence !== "slice"))
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

    const declared = declaredUnits(declaration, input.unit_kind);
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
    if (input.role === "reviewer") {
      // DES-145.01: consume the most recent gate-chain receipt for the unit;
      // an earlier PASS never survives a later FAIL, and VERIFIED is not a PASS.
      const unitReceipts = receipts.filter((receipt) => {
        if (!isPlainObject(receipt) || receipt.kind !== "gate_chain") return false;
        const id = receipt.unit_id || receipt.assurance_unit;
        return id === requested;
      });
      const latest = unitReceipts[unitReceipts.length - 1];
      if (!latest || latest.verdict !== "PASS") {
        return verdict("NEEDS_MORE_EVIDENCE", "reviewer_gate_chain_receipt_missing");
      }
      return verdict("PASS", "reviewer_consumes_gate_chain_receipt");
    }
    return verdict("PASS", "assurance_round_available");
  } catch {
    return verdict("NEEDS_MORE_EVIDENCE", "assurance_budget_unavailable");
  }
}

const sameTestIds = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length) return false;
  if (a.length !== b.length) return false;
  // Multiset comparison: sorted equality rejects duplicate-swapped ids.
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
};

/**
 * Fail-fast deterministic gate chain over POLICY.gate_order.
 * Declared-but-missing tool or `not_run` is a typed gap
 * (NEEDS_MORE_EVIDENCE), never PASS; undeclared gates fail closed unless
 * NOT_APPLICABLE with a reason; the red-then-green gate needs a receipt
 * holding both the baseline failing run and the candidate passing run over
 * the same test ids.
 *
 * @param {{ gate_declarations?: object, results?: object }} input
 * @returns {{ outcome: string, failed_gate?: string, gates: Array<{ gate: string, outcome: string }> }}
 */
function evaluateGateChain(input) {
  const gates = [];
  const fail = (gate, outcome) => {
    gates.push({ gate, outcome });
    return { outcome, failed_gate: gate, gates };
  };
  try {
    if (!isPlainObject(input)) {
      return { outcome: "NEEDS_MORE_EVIDENCE", failed_gate: POLICY.gate_order[0], gates };
    }
    const declarations = isPlainObject(input.gate_declarations) ? input.gate_declarations : {};
    const results = isPlainObject(input.results) ? input.results : {};
    for (const gate of POLICY.gate_order) {
      const declaration = declarations[gate];
      if (!isPlainObject(declaration)) {
        return fail(gate, "NEEDS_MORE_EVIDENCE");
      }
      if (declaration.status === "NOT_APPLICABLE") {
        if (typeof declaration.reason !== "string" || !declaration.reason.trim()) {
          return fail(gate, "NEEDS_MORE_EVIDENCE");
        }
        gates.push({ gate, outcome: "PASS" });
        continue;
      }
      if (declaration.status !== "DECLARED" || !declaration.tool || !declaration.threshold) {
        return fail(gate, "NEEDS_MORE_EVIDENCE");
      }
      const result = results[gate];
      if (!isPlainObject(result)) {
        return fail(gate, "NEEDS_MORE_EVIDENCE");
      }
      // A DECLARED gate passes only on a live tool: omitted tool_available
      // is a typed gap, same as false or not_run.
      if (result.tool_available !== true || result.outcome === "not_run") {
        return fail(gate, "NEEDS_MORE_EVIDENCE");
      }
      if (gate === "red_then_green") {
        const receipt = isPlainObject(result.receipt) ? result.receipt : null;
        const baseline = receipt && isPlainObject(receipt.baseline) ? receipt.baseline : null;
        const candidate = receipt && isPlainObject(receipt.candidate) ? receipt.candidate : null;
        const valid =
          baseline &&
          candidate &&
          baseline.outcome === "FAIL" &&
          candidate.outcome === "PASS" &&
          sameTestIds(baseline.test_ids, candidate.test_ids);
        if (!valid) {
          return fail(gate, "NEEDS_MORE_EVIDENCE");
        }
        gates.push({ gate, outcome: "PASS" });
        continue;
      }
      if (result.outcome === "FAIL") {
        return fail(gate, "FAIL");
      }
      if (
        typeof result.score === "number" &&
        typeof declaration.threshold === "number" &&
        result.score < declaration.threshold
      ) {
        return fail(gate, "FAIL");
      }
      if (result.outcome !== "PASS") {
        return fail(gate, "NEEDS_MORE_EVIDENCE");
      }
      gates.push({ gate, outcome: "PASS" });
    }
    return { outcome: "PASS", gates };
  } catch {
    return { outcome: "NEEDS_MORE_EVIDENCE", failed_gate: POLICY.gate_order[0], gates };
  }
}

module.exports = { POLICY, evaluateAssuranceBudget, evaluateGateChain };

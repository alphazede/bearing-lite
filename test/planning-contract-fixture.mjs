/**
 * Shared fixture for the future-planning contract (#205, #204, #157, #155):
 * the per-unit review-round declaration, the one planning wave, and the
 * Boundary/Data-Flow Contract. Not a test file; imported by the freeze tests.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderDodManifest, TEMPLATE_VERSION } from "../tools/render-dod-manifest.mjs";

export const REQUIRED_SESSIONS = Object.freeze(["planning_and_design", "integration_engineer", "test_engineer"]);

export function planningSessions(candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: "d1" }, names = REQUIRED_SESSIONS, verdict = "READY") {
  return {
    required_sessions: [...names],
    sessions: names.map((session) => ({ session, ...candidate, verdict })),
  };
}

export function reviewRounds(units = ["direct"], kind = "phase") {
  const row = (unit_id, unit_kind) => ({
    unit_id, unit_kind, reviewer_rounds: 1, repairs_max: 1, closure: "deterministic_PASS",
  });
  return [row("planning", "planning"), ...units.map((unit) => row(unit, kind))];
}

/** Complete, referenced independent review evidence, kept separate from closure. */
export function planningWave(candidate_digest, extra = {}, dir) {
  const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest };
  const sessions = planningSessions(candidate);
  const review = {
    candidate,
    planning_wave: sessions,
    dod_manifest: { output_name: "review.html" },
    reviewer_slots: [{ slot_id: "one", primary_route_ref: "independent-route", fallback_route_refs: [] }],
    round_number: 1, completed_rounds: 1,
    receipts: [{ slot_id: "one", selected_route_ref: "independent-route", ...candidate,
      independent: true, findings_isolated: true, verdict: "ACCEPT" }],
    aggregation_complete: true, aggregated_repairs: 0,
  };
  const bytes = JSON.stringify(review);
  mkdirSync(path.join(dir, "gate-evidence"), { recursive: true });
  writeFileSync(path.join(dir, "gate-evidence/planning-review.json"), bytes);
  writeFileSync(path.join(dir, "review.html"), renderDodManifest({
    dod_manifest: { template_version: TEMPLATE_VERSION, output_name: "review.html", title: "Synthetic review" },
  }).html);
  return {
    ...structuredClone(sessions),
    reviews: 1, repairs: 0, closure: "deterministic_PASS", candidate_digest,
    closing_candidate: { ...candidate },
    review_receipt: { path: "gate-evidence/planning-review.json", sha256: createHash("sha256").update(bytes).digest("hex") },
    ...(extra.repairs === 1 ? { repair: { from_candidate: candidate, to_candidate: candidate, deterministic_gate: "PASS" } } : {}),
    ...extra,
  };
}

export const BOUNDARY_NA = Object.freeze({
  not_applicable: true,
  reason: "Single-module change; no material cross-component, protocol, state, or trust boundary.",
});

/** journey_settings additions plus boundary_contract for a valid future package. */
export function planningContract(candidate_digest, { units, kind, dir } = {}) {
  return {
    journey_settings: {
      review_rounds: reviewRounds(units, kind),
      planning_wave: planningWave(candidate_digest, {}, dir),
    },
    boundary_contract: { ...BOUNDARY_NA },
  };
}

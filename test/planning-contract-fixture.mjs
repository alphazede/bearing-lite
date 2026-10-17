/**
 * Shared fixture for the future-planning contract (#205, #204, #157, #155):
 * the per-unit review-round declaration, the one planning wave, and the
 * Boundary/Data-Flow Contract. Not a test file; imported by the freeze tests.
 */
export const REQUIRED_SESSIONS = Object.freeze(["planning_and_design", "integration_engineer", "test_engineer"]);

export function planningSessions(candidate_ref = "plan", names = REQUIRED_SESSIONS, verdict = "READY") {
  return {
    required_sessions: [...names],
    sessions: names.map((session) => ({ session, candidate_ref, verdict })),
  };
}

export function reviewRounds(units = ["direct"], kind = "phase") {
  const row = (unit_id, unit_kind) => ({
    unit_id, unit_kind, reviewer_rounds: 1, repairs_max: 1, closure: "deterministic_PASS",
  });
  return [row("planning", "planning"), ...units.map((unit) => row(unit, kind))];
}

/** Completed wave receipt bound to the closing candidate digest. */
export function planningWave(candidate_digest, extra = {}) {
  return {
    ...planningSessions(),
    reviews: 1,
    repairs: 0,
    closure: "deterministic_PASS",
    candidate_digest,
    ...extra,
  };
}

export const BOUNDARY_NA = Object.freeze({
  not_applicable: true,
  reason: "Single-module change; no material cross-component, protocol, state, or trust boundary.",
});

/** journey_settings additions plus boundary_contract for a valid future package. */
export function planningContract(candidate_digest, { units, kind } = {}) {
  return {
    journey_settings: {
      review_rounds: reviewRounds(units, kind),
      planning_wave: planningWave(candidate_digest),
    },
    boundary_contract: { ...BOUNDARY_NA },
  };
}

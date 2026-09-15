/**
 * CMD-ROUTING-01 / SEIT-ROUTING-01
 * Direct, Coordinator-owned wave, and Orchestrator-sequenced routes; dormancy negatives.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {'implementer'|'coordinator'|'navigator'|'validator'|'reviewer'|'integration-engineer'|'test-engineer'} Role */

/**
 * @typedef {{
 *   kind: 'direct' | 'coordinator_wave' | 'expedition',
 *   packetCount?: number,
 *   multiWaveConflict?: boolean,
 *   nestedLanes?: number,
 *   requiredAssurance?: string[],
 *   coordinatorImplements?: boolean,
 *   forceControllersOnSinglePacket?: boolean,
 *   omitWaveCoordination?: boolean,
 *   assignNavigator?: boolean,
 *   assignValidator?: boolean,
 *   assignTrailBoss?: boolean,
 *   assignSubExplorer?: boolean,
 *   coordinatorRoute?: 'enabled' | 'disabled' | 'omitted',
 *   implicitCoordinatorDispatch?: boolean,
 *   sharedWaveEvidence?: boolean,
 *   aggregateRepairOwnership?: boolean,
 * }} RouteInput
 *
 * @typedef {{
 *   ok: true,
 *   active: Role[],
 *   dormant: Role[],
 *   coordinators: Role[],
 *   workers: Role[],
 *   parentController: 'orchestrator' | 'coordinator',
 * } | {
 *   ok: false,
 *   code: string,
 *   message: string,
 * }} RouteVerdict
 */

const ALL_ROLES = /** @type {const} */ ([
  "implementer",
  "coordinator",
  "reviewer",
  "integration-engineer",
  "test-engineer",
]);

/**
 * Select the smallest valid route for a fixture input (pure policy model of product contracts).
 * @param {RouteInput} input
 * @returns {RouteVerdict}
 */
export function selectRoute(input) {
  // Negative policy violations first.
  if (input.coordinatorImplements === true) {
    return {
      ok: false,
      code: "coordinator_performs_packet_work",
      message: "Coordinator must not implement packet work; assign Implementer",
    };
  }
  if (input.forceControllersOnSinglePacket === true && (input.packetCount ?? 1) <= 1) {
    return {
      ok: false,
      code: "single_packet_forces_controllers",
      message: "Single packet must not force coordination roles",
    };
  }
  if (input.kind === "expedition" && input.omitWaveCoordination === true) {
    return {
      ok: false,
      code: "expedition_omits_wave_coordination",
      message: "Expedition requires Router wave coordination",
    };
  }
  if (input.assignNavigator === true) {
    return {
      ok: false,
      code: "navigator_not_normal_role",
      message: "Navigator is a compatibility diagnostic; Router owns sequencing",
    };
  }
  const requestedAssurance = (input.requiredAssurance ?? []).map((role) =>
    String(role).toLowerCase().replace(/[\s_]+/g, "-")
  );
  if (requestedAssurance.includes("validator") || input.assignValidator === true) {
    return {
      ok: false,
      code: "validator_not_active_role",
      message: "Validator is compatibility-only and is not an active assurance role",
    };
  }
  if (input.assignTrailBoss === true || input.assignSubExplorer === true) {
    return {
      ok: false,
      code: "full_bearing_topology_not_in_lite",
      message: "Trail Boss and Sub-Explorer stay out of Lite",
    };
  }
  if (input.kind === "direct" && input.implicitCoordinatorDispatch === true) {
    return {
      ok: false,
      code: "implicit_coordinator_dispatch",
      message: "Direct packets never dispatch Coordinator",
    };
  }

  /** @type {Role[]} */
  const active = [];
  const packetCount = input.packetCount ?? (input.kind === "direct" ? 1 : 2);
  const oneWaveNeed =
    input.kind !== "direct" &&
    (packetCount >= 2 ||
      input.sharedWaveEvidence === true ||
      input.aggregateRepairOwnership === true ||
      input.kind === "coordinator_wave" ||
      input.kind === "expedition");
  const coordinatorRoute = input.coordinatorRoute ?? "enabled";
  const coordinatorAvailable = coordinatorRoute === "enabled";

  if (input.kind === "direct") {
    active.push("implementer");
  } else if (input.kind === "coordinator_wave" || input.kind === "expedition") {
    if (oneWaveNeed && !coordinatorAvailable) {
      return {
        ok: false,
        code: "typed_capability_gap",
        message:
          "A wave that needs Coordinator while the route is omitted or disabled is a typed capability gap, not silent Orchestrator substitution",
      };
    }
    if (oneWaveNeed && coordinatorAvailable) {
      active.push("coordinator");
    }
    active.push("implementer");
  } else {
    return {
      ok: false,
      code: "unknown_route_kind",
      message: `unknown route kind`,
    };
  }

  for (const key of requestedAssurance) {
    if (
      (key === "test-engineer" ||
        key === "assurance-test-engineer" ||
        key === "planning-test-engineer") &&
      !active.includes("test-engineer")
    ) {
      active.push("test-engineer");
    }
    if ((key === "reviewer" || key === "park-ranger") && !active.includes("reviewer")) {
      active.push("reviewer");
    }
    if (
      (key === "integration-engineer" ||
        key === "integration_engineer.execution" ||
        key === "surveyor") &&
      !active.includes("integration-engineer")
    ) {
      active.push("integration-engineer");
    }
  }

  const activeSet = new Set(active);
  const dormant = ALL_ROLES.filter((r) => !activeSet.has(r));
  const coordinators = active.filter((r) => r === "coordinator");
  const workers = active.filter((r) => r === "implementer");

  // Direct never activates controllers.
  if (input.kind === "direct") {
    assert.ok(!active.includes("navigator"));
    assert.ok(!active.includes("coordinator"));
  }

  return {
    ok: true,
    active: [...active],
    dormant,
    coordinators,
    workers,
    parentController: coordinators.length > 0 ? "coordinator" : "orchestrator",
  };
}

describe("CMD-ROUTING-01 role-routing (SEIT-ROUTING-01)", () => {
  it("Direct: Implementer only (+ optional assurance) with self-check path", () => {
    const verdict = selectRoute({ kind: "direct", packetCount: 1, requiredAssurance: [] });
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.deepEqual(verdict.active, ["implementer"]);
      assert.deepEqual(verdict.workers, ["implementer"]);
      assert.deepEqual(verdict.coordinators, []);
      assert.ok(verdict.dormant.includes("coordinator"));
      assert.ok(!verdict.active.includes("navigator"));
      assert.equal(verdict.parentController, "orchestrator");
    }
  });

  it("Coordinator-owned wave: Coordinator + Implementers; Coordinator does not implement", () => {
    const verdict = selectRoute({
      kind: "coordinator_wave",
      packetCount: 3,
      requiredAssurance: [],
    });
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.ok(verdict.active.includes("coordinator"));
      assert.ok(verdict.active.includes("implementer"));
      assert.ok(!verdict.active.includes("navigator"));
      assert.equal(verdict.parentController, "coordinator");
    }
  });

  it("Orchestrator sequences waves; Coordinator owns lanes; Navigator is not a route role", () => {
    const simple = selectRoute({ kind: "expedition", packetCount: 4 });
    assert.equal(simple.ok, true);
    if (simple.ok) {
      assert.ok(!simple.active.includes("navigator"));
      assert.ok(simple.active.includes("coordinator"));
      assert.ok(simple.active.includes("implementer"));
      assert.deepEqual(simple.coordinators, ["coordinator"]);
    }
    const conflicted = selectRoute({
      kind: "expedition",
      multiWaveConflict: true,
      nestedLanes: 2,
    });
    assert.equal(conflicted.ok, true);
    if (conflicted.ok) {
      assert.deepEqual(conflicted.active, ["coordinator", "implementer"]);
      assert.deepEqual(conflicted.coordinators, ["coordinator"]);
    }
  });

  it("negative: assigning Navigator is a compatibility diagnostic, not a route", () => {
    const verdict = selectRoute({ kind: "expedition", assignNavigator: true });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, "navigator_not_normal_role");
  });

  it("Validator is not an active route role; assurance is Test Engineer then Reviewer then Integration Engineer execution", () => {
    const routing = readFileSync(
      path.join(ROOT, "skills/bearing-lite/references/role-routing.mmd"),
      "utf8"
    );
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.doesNotMatch(routing, /Validator declared/);
    assert.match(routing, /Assurance Test Engineer|Test Engineer/);
    assert.match(routing, /Reviewer/);
    assert.match(routing, /Integration Engineer execution/);
    assert.doesNotMatch(readme, /Validator, Park Ranger, and Surveyor appear only when declared/);
    assert.doesNotMatch(readme, /\|\s*\*\*Park Ranger\*\*/);
    assert.doesNotMatch(readme, /\|\s*\*\*Surveyor\*\*/);
    assert.match(readme, /Assurance Test Engineer/);
    assert.match(readme, /Reviewer/);
    assert.match(readme, /Integration Engineer/);
    const rejected = selectRoute({ kind: "direct", requiredAssurance: ["validator"] });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "validator_not_active_role");
    const ok = selectRoute({
      kind: "direct",
      requiredAssurance: ["test-engineer", "reviewer", "integration-engineer"],
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.ok(ok.active.includes("test-engineer"));
      assert.ok(ok.active.includes("reviewer"));
      assert.ok(ok.active.includes("integration-engineer"));
      assert.ok(!ok.active.includes("validator"));
    }
  });

  it("negative: Trail Boss and Sub-Explorer are not Lite routes", () => {
    const trail = selectRoute({ kind: "expedition", assignTrailBoss: true });
    assert.equal(trail.ok, false);
    if (!trail.ok) assert.equal(trail.code, "full_bearing_topology_not_in_lite");
    const sub = selectRoute({ kind: "expedition", assignSubExplorer: true });
    assert.equal(sub.ok, false);
    if (!sub.ok) assert.equal(sub.code, "full_bearing_topology_not_in_lite");
  });

  it("negative: removed delegated route is rejected", () => {
    const verdict = selectRoute({ kind: "delegated" });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, "unknown_route_kind");
  });

  it("dormant roles create no work entries in the route fixture", () => {
    const verdict = selectRoute({ kind: "direct" });
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      for (const role of verdict.dormant) {
        assert.ok(!verdict.active.includes(role));
        assert.ok(!verdict.coordinators.includes(role));
        assert.ok(!verdict.workers.includes(role));
      }
    }
  });

  it("negative: Coordinator performs packet work is rejected", () => {
    const verdict = selectRoute({
      kind: "coordinator_wave",
      coordinatorImplements: true,
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "coordinator_performs_packet_work");
    }
  });

  it("negative: single packet forces controllers is rejected", () => {
    const verdict = selectRoute({
      kind: "direct",
      packetCount: 1,
      forceControllersOnSinglePacket: true,
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "single_packet_forces_controllers");
    }
  });

  it("positive: direct packet executes without Coordinator whether omitted, disabled, or enabled", () => {
    for (const coordinatorRoute of /** @type {const} */ (["omitted", "disabled", "enabled"])) {
      const verdict = selectRoute({
        kind: "direct",
        packetCount: 1,
        coordinatorRoute,
      });
      assert.equal(verdict.ok, true, coordinatorRoute);
      if (verdict.ok) {
        assert.deepEqual(verdict.active, ["implementer"]);
        assert.deepEqual(verdict.coordinators, []);
        assert.ok(verdict.dormant.includes("coordinator"));
        assert.equal(verdict.parentController, "orchestrator");
        assert.ok(!verdict.active.includes("coordinator"));
      }
    }
  });

  it("positive: disabling Coordinator on a true direct packet is not a capability gap", () => {
    const omitted = selectRoute({ kind: "direct", coordinatorRoute: "omitted" });
    const disabled = selectRoute({ kind: "direct", coordinatorRoute: "disabled" });
    assert.equal(omitted.ok, true);
    assert.equal(disabled.ok, true);
    if (omitted.ok) {
      assert.equal(omitted.parentController, "orchestrator");
      assert.ok(!omitted.active.includes("coordinator"));
    }
    if (disabled.ok) {
      assert.equal(disabled.parentController, "orchestrator");
      assert.ok(!disabled.active.includes("coordinator"));
    }
    const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
    const onboarding = readFileSync(path.join(ROOT, "docs/guides/onboarding.md"), "utf8");
    assert.match(router, /Direct packets never dispatch Coordinator/);
    assert.match(router, /Orchestrator is the parent controller/);
    assert.match(onboarding, /Disabling Coordinator on a true direct packet is not a capability gap/);
    assert.match(onboarding, /explicit disabled choice/);
  });

  it("negative: implicit Coordinator dispatch on a direct packet is rejected", () => {
    const verdict = selectRoute({
      kind: "direct",
      packetCount: 1,
      implicitCoordinatorDispatch: true,
      coordinatorRoute: "enabled",
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "implicit_coordinator_dispatch");
    }
    const routing = readFileSync(
      path.join(ROOT, "skills/bearing-lite/references/role-routing.mmd"),
      "utf8"
    );
    assert.match(routing, /direct packet not yet/);
    assert.match(routing, /coordinator wave not yet/);
    assert.equal(routing.includes("A -->|not yet| E"), false);
  });

  it("negative: a coordinator wave with omitted or disabled Coordinator is a typed capability gap", () => {
    for (const coordinatorRoute of /** @type {const} */ (["omitted", "disabled"])) {
      const verdict = selectRoute({
        kind: "coordinator_wave",
        packetCount: 2,
        sharedWaveEvidence: true,
        coordinatorRoute,
      });
      assert.equal(verdict.ok, false, coordinatorRoute);
      if (!verdict.ok) {
        assert.equal(verdict.code, "typed_capability_gap");
        assert.match(verdict.message, /not silent Orchestrator substitution/);
      }
    }
  });

  it("Coordinator enabled does not dispatch on a direct packet", () => {
    const verdict = selectRoute({
      kind: "direct",
      packetCount: 1,
      coordinatorRoute: "enabled",
    });
    assert.equal(verdict.ok, true);
    if (verdict.ok) {
      assert.ok(!verdict.active.includes("coordinator"));
      assert.equal(verdict.parentController, "orchestrator");
    }
  });

  it("negative: Expedition omits wave coordination is rejected", () => {
    const verdict = selectRoute({
      kind: "expedition",
      omitWaveCoordination: true,
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "expedition_omits_wave_coordination");
    }
  });

  it("tdd dispatches Test Implementer before Product Implementer from the frozen snapshot", () => {
    const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
    assert.match(router, /Test Implementer/);
    assert.match(router, /test_implementer|roles\.test_implementer/);
    assert.match(
      router,
      /Test Implementer[\s\S]{0,160}before[\s\S]{0,80}Product Implementer/
    );
    assert.match(router, /frozen snapshot|profile_freeze/);
  });

  it("tdd never copies Test Implementer from Product Implementer, Test Engineer, Light Implementer, or a retired role", () => {
    const profiles = readFileSync(
      path.join(ROOT, "skills/bearing-lite/references/profiles.md"),
      "utf8"
    );
    const onboard = readFileSync(path.join(ROOT, "skills/onboard-bearing/SKILL.md"), "utf8");
    const text = `${profiles}\n${onboard}`;
    assert.match(text, /test_implementer/);
    assert.match(text, /OWNER_DECISION_REQUIRED/);
    assert.match(
      text,
      /never copy|do not copy|must not copy|must ask for the missing Test Implementer/i
    );
    assert.match(text, /Product Implementer|roles\.implementer/);
    assert.match(text, /Test Engineer|test_engineer/);
    assert.match(text, /Light Implementer|light_implementer/);
  });
});

/** Visible #33A lease fields. Packet B revalidates this record; it does not add fields. */
const VISIBLE_LEASE_FIELDS = Object.freeze([
  "journey",
  "controller",
  "repository",
  "checkout",
  "branch",
  "candidate_revision",
  "acquired_at",
  "generation",
  "state",
]);

const LEASE_IDENTITY_FIELDS = Object.freeze([
  "journey",
  "repository",
  "checkout",
  "branch",
  "generation",
]);

/** @typedef {'coordinator'|'implementer'} ExecutionRole */
/** @typedef {'wave_start'|'external_change'|'commit'|'mutation'|'first_write'|'dispatch'|'integration'|'cross_wave_transition'} LeaseBoundary */

export const REQUIRED_LEASE_BOUNDARIES = Object.freeze({
  coordinator: Object.freeze(["wave_start", "external_change", "commit"]),
  implementer: Object.freeze(["wave_start", "external_change", "commit"]),
});

/**
 * @typedef {{
 *   role: ExecutionRole,
 *   boundary: LeaseBoundary,
 *   lease?: Record<string, unknown> | null,
 *   approved: {
 *     journey: string,
 *     repository: string,
 *     checkout: string,
 *     branch: string,
 *     candidate_revision: string,
 *     generation: number,
 *     controller?: string,
 *   },
 *   observed?: {
 *     branch?: string,
 *     candidate_revision?: string,
 *     generation?: number,
 *     parent_revision?: string,
 *     controller?: string,
 *   },
 *   alreadyDispatched?: boolean,
 * }} ExecutionLeaseInput
 *
 * @typedef {{
 *   ok: true,
 *   write: boolean,
 *   dispatch: boolean,
 *   lease: Record<string, unknown>,
 * } | {
 *   ok: false,
 *   code: string,
 *   status: 'WAITING_ON',
 *   message: string,
 *   write: false,
 *   dispatch: false,
 * }} ExecutionLeaseVerdict
 */

/**
 * @param {ExecutionRole} role
 * @param {string} code
 * @param {string} message
 * @returns {ExecutionLeaseVerdict}
 */
function leaseMismatch(role, code, message) {
  return {
    ok: false,
    code,
    status: "WAITING_ON",
    message:
      role === "implementer" ? `${message}; return WAITING_ON without writing` : message,
    write: false,
    dispatch: false,
  };
}

/**
 * Own authorized progress: the returned candidate's parent is the leased revision.
 * @param {Record<string, unknown>} lease
 * @param {unknown} proposedRevision
 * @param {unknown} parentRevision
 */
function isAuthorizedCandidateAdvance(lease, proposedRevision, parentRevision) {
  return (
    typeof proposedRevision === "string" &&
    proposedRevision.trim() !== "" &&
    proposedRevision !== lease.candidate_revision &&
    parentRevision === lease.candidate_revision
  );
}

/**
 * Revalidate the visible checkout lease at one execution boundary.
 * Does not acquire, resume, recover, or release; those stay Router-owned.
 * @param {ExecutionLeaseInput} input
 * @returns {ExecutionLeaseVerdict}
 */
export function revalidateExecutionLease(input) {
  const required = REQUIRED_LEASE_BOUNDARIES[input.role];
  if (!required) {
    return leaseMismatch(
      input.role,
      "unknown_execution_role",
      "only Coordinator and Implementer revalidate at execution boundaries"
    );
  }
  if (!required.includes(input.boundary)) {
    return leaseMismatch(
      input.role,
      "undeclared_execution_boundary",
      `${input.role} has no ${input.boundary} lease-revalidation boundary`
    );
  }

  const lease = input.lease;
  if (!lease || typeof lease !== "object" || Array.isArray(lease)) {
    return leaseMismatch(input.role, "forged_lease", "forged lease records fail closed");
  }
  for (const key of Object.keys(lease)) {
    if (!VISIBLE_LEASE_FIELDS.includes(key)) {
      return leaseMismatch(input.role, "forged_lease", "forged lease records fail closed");
    }
  }
  for (const field of VISIBLE_LEASE_FIELDS) {
    if (!(field in lease) || lease[field] === undefined || lease[field] === null) {
      return leaseMismatch(input.role, "forged_lease", "forged lease records fail closed");
    }
  }
  if (!Number.isInteger(lease.generation) || /** @type {number} */ (lease.generation) < 1) {
    return leaseMismatch(input.role, "forged_lease", "forged lease records fail closed");
  }
  if (lease.state !== "active" && lease.state !== "released") {
    return leaseMismatch(input.role, "forged_lease", "forged lease records fail closed");
  }
  if (lease.state !== "active") {
    return leaseMismatch(
      input.role,
      "lease_not_active",
      "released lease cannot authorize mutation, dispatch, or integration"
    );
  }

  const approved = input.approved;
  for (const field of LEASE_IDENTITY_FIELDS) {
    if (lease[field] !== approved[field]) {
      const code =
        field === "generation"
          ? "stale_generation"
          : field === "journey"
            ? "checkout_lease_conflict"
            : "lease_identity_drift";
      return leaseMismatch(
        input.role,
        code,
        `${field} no longer matches the approved checkout lease`
      );
    }
  }
  if (approved.controller !== undefined && approved.controller !== lease.controller) {
    return leaseMismatch(
      input.role,
      "lease_identity_drift",
      "controller no longer matches the approved checkout lease"
    );
  }

  const observed = input.observed;
  if (observed) {
    if (observed.branch !== undefined && observed.branch !== lease.branch) {
      return leaseMismatch(
        input.role,
        "lease_identity_drift",
        "branch or HEAD drift invalidates the lease before mutation"
      );
    }
    if (observed.generation !== undefined && observed.generation !== lease.generation) {
      return leaseMismatch(
        input.role,
        "stale_generation",
        "stale-generation lease records fail closed"
      );
    }
    if (observed.controller !== undefined && observed.controller !== lease.controller) {
      return leaseMismatch(
        input.role,
        "lease_identity_drift",
        "foreign controller cannot use this lease"
      );
    }
  }

  const proposedRevision =
    observed && observed.candidate_revision !== undefined
      ? observed.candidate_revision
      : approved.candidate_revision;
  const parentRevision = observed ? observed.parent_revision : undefined;
  let nextLease = lease;
  if (proposedRevision !== lease.candidate_revision) {
    if (isAuthorizedCandidateAdvance(lease, proposedRevision, parentRevision)) {
      nextLease = { ...lease, candidate_revision: proposedRevision };
    } else {
      return leaseMismatch(
        input.role,
        "lease_identity_drift",
        "branch or HEAD drift invalidates the lease before mutation"
      );
    }
  }

  return {
    ok: true,
    write: input.role === "implementer",
    dispatch: input.boundary === "wave_start" && input.alreadyDispatched !== true,
    lease: nextLease,
  };
}

function fixtureLease(overrides = {}) {
  return {
    journey: "J-A",
    controller: "Router",
    repository: "alphazede/bearing-lite",
    checkout: "wt-main",
    branch: "main",
    candidate_revision: "4040dfe",
    acquired_at: "2026-08-18T00:00:00Z",
    generation: 1,
    state: "active",
    ...overrides,
  };
}

function fixtureApproved(overrides = {}) {
  return {
    journey: "J-A",
    repository: "alphazede/bearing-lite",
    checkout: "wt-main",
    branch: "main",
    candidate_revision: "4040dfe",
    generation: 1,
    ...overrides,
  };
}

describe("CMD-ROUTING-01 checkout-lease revalidation", () => {
  it("every execution role revalidates identity at wave start", () => {
    for (const role of /** @type {const} */ (["coordinator", "implementer"])) {
      assert.ok(REQUIRED_LEASE_BOUNDARIES[role].includes("wave_start"), role);
      const ok = revalidateExecutionLease({
        role,
        boundary: "wave_start",
        lease: fixtureLease(),
        approved: fixtureApproved(),
      });
      assert.equal(ok.ok, true, role);
      const drifted = revalidateExecutionLease({
        role,
        boundary: "wave_start",
        lease: fixtureLease(),
        approved: fixtureApproved({ repository: "other/repo" }),
      });
      assert.equal(drifted.ok, false);
      if (!drifted.ok) {
        assert.equal(drifted.write, false);
        assert.equal(drifted.dispatch, false);
        assert.equal(drifted.status, "WAITING_ON");
        assert.equal(drifted.code, "lease_identity_drift");
      }
    }
  });

  it("Navigator is not an execution revalidation role", () => {
    const verdict = revalidateExecutionLease({
      role: /** @type {ExecutionRole} */ ("navigator"),
      boundary: "wave_start",
      lease: fixtureLease(),
      approved: fixtureApproved(),
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "unknown_execution_role");
      assert.equal(verdict.write, false);
      assert.equal(verdict.dispatch, false);
    }
  });

  it("Coordinator revalidates at wave start, external change, and commit", () => {
    assert.deepEqual(REQUIRED_LEASE_BOUNDARIES.coordinator, [
      "wave_start",
      "external_change",
      "commit",
    ]);
    for (const boundary of ["external_change", "commit"]) {
      const verdict = revalidateExecutionLease({
        role: "coordinator",
        boundary: /** @type {LeaseBoundary} */ (boundary),
        lease: fixtureLease({ checkout: "wt-other" }),
        approved: fixtureApproved(),
      });
      assert.equal(verdict.ok, false, boundary);
      if (!verdict.ok) {
        assert.equal(verdict.code, "lease_identity_drift");
        assert.equal(verdict.dispatch, false);
      }
    }
  });

  it("Implementer does not revalidate before every mutation", () => {
    assert.deepEqual(REQUIRED_LEASE_BOUNDARIES.implementer, [
      "wave_start",
      "external_change",
      "commit",
    ]);
    const mutation = revalidateExecutionLease({
      role: "implementer",
      boundary: "mutation",
      lease: fixtureLease(),
      approved: fixtureApproved(),
    });
    assert.equal(mutation.ok, false);
    if (!mutation.ok) {
      assert.equal(mutation.code, "undeclared_execution_boundary");
      assert.equal(mutation.write, false);
    }
    const mismatch = revalidateExecutionLease({
      role: "implementer",
      boundary: "wave_start",
      lease: fixtureLease({ journey: "J-B" }),
      approved: fixtureApproved(),
    });
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.status, "WAITING_ON");
      assert.equal(mismatch.write, false);
      assert.equal(mismatch.dispatch, false);
      assert.match(mismatch.message, /WAITING_ON without writing/);
    }
    const allowed = revalidateExecutionLease({
      role: "implementer",
      boundary: "commit",
      lease: fixtureLease(),
      approved: fixtureApproved(),
    });
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.write, true);
  });

  it("branch, HEAD, and generation drift fail closed", () => {
    const cases = [
      {
        observed: { branch: "other" },
        code: "lease_identity_drift",
      },
      {
        observed: { candidate_revision: "deadbeef" },
        code: "lease_identity_drift",
      },
      {
        observed: { generation: 0 },
        code: "stale_generation",
      },
      {
        approved: fixtureApproved({ generation: 2 }),
        code: "stale_generation",
      },
    ];
    for (const fixture of cases) {
      const verdict = revalidateExecutionLease({
        role: "coordinator",
        boundary: "external_change",
        lease: fixtureLease(),
        approved: fixture.approved ?? fixtureApproved(),
        observed: fixture.observed,
      });
      assert.equal(verdict.ok, false, fixture.code);
      if (!verdict.ok) {
        assert.equal(verdict.code, fixture.code);
        assert.equal(verdict.write, false);
        assert.equal(verdict.dispatch, false);
      }
    }
  });

  it("released, stale, and forged leases fail closed", () => {
    const released = revalidateExecutionLease({
      role: "coordinator",
      boundary: "commit",
      lease: fixtureLease({ state: "released" }),
      approved: fixtureApproved(),
    });
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "lease_not_active");

    const stale = revalidateExecutionLease({
      role: "coordinator",
      boundary: "wave_start",
      lease: fixtureLease({ generation: 3 }),
      approved: fixtureApproved({ generation: 3 }),
      observed: { generation: 1 },
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "stale_generation");

    const forged = revalidateExecutionLease({
      role: "implementer",
      boundary: "wave_start",
      lease: fixtureLease({
        // @ts-expect-error intentional fixture
        pid: 999,
      }),
      approved: fixtureApproved(),
    });
    assert.equal(forged.ok, false);
    if (!forged.ok) {
      assert.equal(forged.code, "forged_lease");
      assert.equal(forged.write, false);
      assert.equal(forged.status, "WAITING_ON");
    }
  });

  it("same valid lease continues without duplicate dispatch", () => {
    const first = revalidateExecutionLease({
      role: "coordinator",
      boundary: "wave_start",
      lease: fixtureLease(),
      approved: fixtureApproved(),
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.dispatch, true);

    const resume = revalidateExecutionLease({
      role: "coordinator",
      boundary: "wave_start",
      lease: fixtureLease(),
      approved: fixtureApproved(),
      alreadyDispatched: true,
    });
    assert.equal(resume.ok, true);
    if (resume.ok) {
      assert.equal(resume.dispatch, false);
      assert.equal(resume.write, false);
    }

    const wave = revalidateExecutionLease({
      role: "coordinator",
      boundary: "commit",
      lease: fixtureLease(),
      approved: fixtureApproved(),
      alreadyDispatched: true,
    });
    assert.equal(wave.ok, true);
    if (wave.ok) assert.equal(wave.dispatch, false);
  });

  it("authorized same-Lifecycle candidate progress refreshes revision on the same generation", () => {
    const lease = fixtureLease({ candidate_revision: "4040dfe", generation: 1 });
    const integrate = revalidateExecutionLease({
      role: "coordinator",
      boundary: "commit",
      lease,
      approved: fixtureApproved({ candidate_revision: "cafebabe" }),
      observed: {
        candidate_revision: "cafebabe",
        parent_revision: "4040dfe",
      },
    });
    assert.equal(integrate.ok, true, JSON.stringify(integrate));
    if (!integrate.ok) return;
    assert.equal(integrate.lease.candidate_revision, "cafebabe");
    assert.equal(integrate.lease.generation, 1);
    assert.equal(integrate.lease.state, "active");
    assert.equal(integrate.write, false);

    const nextDispatch = revalidateExecutionLease({
      role: "coordinator",
      boundary: "wave_start",
      lease: integrate.lease,
      approved: fixtureApproved({ candidate_revision: "cafebabe" }),
    });
    assert.equal(nextDispatch.ok, true, JSON.stringify(nextDispatch));
    if (!nextDispatch.ok) return;
    assert.equal(nextDispatch.dispatch, true);
    assert.equal(nextDispatch.lease.candidate_revision, "cafebabe");
    assert.equal(nextDispatch.lease.generation, 1);

    const nextWrite = revalidateExecutionLease({
      role: "implementer",
      boundary: "commit",
      lease: integrate.lease,
      approved: fixtureApproved({ candidate_revision: "cafebabe" }),
    });
    assert.equal(nextWrite.ok, true, JSON.stringify(nextWrite));
    if (!nextWrite.ok) return;
    assert.equal(nextWrite.write, true);
  });

  it("foreign controller, unrelated HEAD, and released lease stay WAITING_ON without mutation", () => {
    const foreignController = revalidateExecutionLease({
      role: "coordinator",
      boundary: "commit",
      lease: fixtureLease(),
      approved: fixtureApproved({ controller: "Other" }),
    });
    assert.equal(foreignController.ok, false);
    if (!foreignController.ok) {
      assert.equal(foreignController.status, "WAITING_ON");
      assert.equal(foreignController.write, false);
      assert.equal(foreignController.dispatch, false);
    }

    const unrelatedHead = revalidateExecutionLease({
      role: "coordinator",
      boundary: "external_change",
      lease: fixtureLease({ candidate_revision: "4040dfe" }),
      approved: fixtureApproved({ candidate_revision: "deadbeef" }),
      observed: {
        candidate_revision: "deadbeef",
        parent_revision: "not-the-leased-parent",
      },
    });
    assert.equal(unrelatedHead.ok, false);
    if (!unrelatedHead.ok) {
      assert.equal(unrelatedHead.status, "WAITING_ON");
      assert.equal(unrelatedHead.code, "lease_identity_drift");
      assert.equal(unrelatedHead.write, false);
    }

    const released = revalidateExecutionLease({
      role: "coordinator",
      boundary: "commit",
      lease: fixtureLease({ state: "released" }),
      approved: fixtureApproved(),
      observed: {
        candidate_revision: "cafebabe",
        parent_revision: "4040dfe",
      },
    });
    assert.equal(released.ok, false);
    if (!released.ok) {
      assert.equal(released.status, "WAITING_ON");
      assert.equal(released.code, "lease_not_active");
      assert.equal(released.write, false);
    }
  });
});

/**
 * @typedef {{
 *   role: Role,
 *   envelopeUnchanged?: boolean,
 *   independentWork?: boolean,
 *   ownerChoiceFresh?: boolean,
 *   boundary?: 'slice' | 'round' | 'phase' | 'lifecycle',
 *   reuseAuthor?: boolean,
 * }} ContinuationInput
 */

/**
 * Skill-contract model of session reuse. Hosts start sessions; this only
 * says when a fresh session is required.
 * @param {ContinuationInput} input
 */
export function selectContinuation(input) {
  const assurance = new Set(["test-engineer", "reviewer", "integration-engineer"]);
  if (input.role === "validator") {
    return { ok: false, code: "validator_not_active_role", fresh: false, continue: false };
  }
  if (input.role === "navigator") {
    return { ok: false, code: "navigator_not_normal_role", fresh: false, continue: false };
  }
  if (assurance.has(input.role)) {
    if (input.boundary === "slice" || input.boundary === "round") {
      return { ok: false, code: "assurance_unconfigured_boundary", fresh: true, continue: false };
    }
    if (input.reuseAuthor) {
      return { ok: false, code: "assurance_reuses_author", fresh: true, continue: false };
    }
    return { ok: true, fresh: true, continue: false };
  }
  if (input.role === "implementer" || input.role === "coordinator") {
    if (input.independentWork || input.ownerChoiceFresh || input.envelopeUnchanged === false) {
      return { ok: true, fresh: true, continue: false };
    }
    return { ok: true, fresh: false, continue: true };
  }
  return { ok: false, code: "unknown_role", fresh: false, continue: false };
}

/**
 * @param {{ receipt?: boolean, rereadAllAccepted?: boolean, redispatchCompleted?: boolean }} input
 */
export function resumeFromWaveReceipt(input) {
  if (!input.receipt) return { ok: false, code: "missing_wave_receipt" };
  if (input.rereadAllAccepted) return { ok: false, code: "receipt_avoids_full_reread" };
  if (input.redispatchCompleted) return { ok: false, code: "completed_slices_stay_complete" };
  return { ok: true };
}

describe("CMD-ROUTING-01 same-wave continuation and at-end assurance", () => {
  it("matching: three dependent slices plus one correction reuse one Implementer", () => {
    const slices = ["T1", "T2", "T3", "T3-repair"].map(() =>
      selectContinuation({ role: "implementer", envelopeUnchanged: true })
    );
    for (const step of slices) {
      assert.equal(step.ok, true);
      assert.equal(step.continue, true);
      assert.equal(step.fresh, false);
    }
    const receipt = resumeFromWaveReceipt({ receipt: true });
    assert.equal(receipt.ok, true);
  });

  it("non-matching: assurance cannot reuse author context or run at an unconfigured slice or round", () => {
    const retired = selectContinuation({ role: "validator", boundary: "phase" });
    assert.equal(retired.ok, false);
    if (!retired.ok) assert.equal(retired.code, "validator_not_active_role");
    for (const role of /** @type {const} */ (["test-engineer", "reviewer", "integration-engineer"])) {
      const slice = selectContinuation({ role, boundary: "slice" });
      assert.equal(slice.ok, false);
      if (!slice.ok) assert.equal(slice.code, "assurance_unconfigured_boundary");
      const reuse = selectContinuation({ role, boundary: "phase", reuseAuthor: true });
      assert.equal(reuse.ok, false);
      if (!reuse.ok) assert.equal(reuse.code, "assurance_reuses_author");
      const ok = selectContinuation({ role, boundary: "phase" });
      assert.equal(ok.ok, true);
      assert.equal(ok.fresh, true);
    }
  });

  it("interruption resumes from the visible receipt without rereading or redispatch", () => {
    assert.equal(resumeFromWaveReceipt({ receipt: true }).ok, true);
    const reread = resumeFromWaveReceipt({ receipt: true, rereadAllAccepted: true });
    assert.equal(reread.ok, false);
    if (!reread.ok) assert.equal(reread.code, "receipt_avoids_full_reread");
    const redispatch = resumeFromWaveReceipt({ receipt: true, redispatchCompleted: true });
    assert.equal(redispatch.ok, false);
    if (!redispatch.ok) assert.equal(redispatch.code, "completed_slices_stay_complete");
  });

  it("external change or envelope change forces revalidation or a fresh session", () => {
    const fresh = selectContinuation({
      role: "implementer",
      envelopeUnchanged: false,
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.fresh, true);
    const drift = revalidateExecutionLease({
      role: "implementer",
      boundary: "external_change",
      lease: fixtureLease(),
      approved: fixtureApproved(),
      observed: { branch: "other" },
    });
    assert.equal(drift.ok, false);
    if (!drift.ok) assert.equal(drift.code, "lease_identity_drift");
  });
});

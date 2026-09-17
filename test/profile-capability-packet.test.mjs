/**
 * Issue #114 remainder: frozen snapshot → Reviewer/assurance packet projection.
 * Freeze helper is covered elsewhere; this file covers declaration source,
 * live-catalog drift, selected-but-unavailable, OCR identity, and
 * roles-only reconciliation instruction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const coverage = require(path.join(ROOT, "hooks/review-capability.cjs"));

const OCR_IDENTITY = "OpenCodeReview";
const REV = "b5cec79f04f6f6ea506a2ad89bf937aab143d876";
const BASE = "7ee098db3c2b1746a50222746c6a2428822ce4dd";
const candidate = { candidate_ref: "cand-114", candidate_revision: REV, diff_base: BASE };

const PROFILES_MD = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/profiles.md"),
  "utf8",
);
const REVIEW_CAP_MD = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/review-capability.md"),
  "utf8",
);
const VERIFICATION_MD = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/verification.md"),
  "utf8",
);
const ASSURANCE_MD = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/assurance-policy.md"),
  "utf8",
);
const ROUTER_SKILL = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");

function baseProfile() {
  return {
    roles: {
      implementer: {
        enabled: true,
        primary: { harness: "harness-a", model: "model-a", reasoning: "reasoning-a" },
        ordered_fallbacks: [],
      },
      reviewer: {
        enabled: true,
        primary: { harness: "harness-b", model: "model-b", reasoning: "reasoning-b" },
        ordered_fallbacks: [],
      },
    },
  };
}

/**
 * Parent-controller projection: packets read the frozen snapshot, name
 * OpenCodeReview explicitly, and never substitute a generic capability string
 * for a missing binding.
 */
function declareCoverageFromFrozen({ snapshot, host }) {
  const assist =
    snapshot && snapshot.review && snapshot.review.coverage_assist
      ? snapshot.review.coverage_assist
      : null;
  const enabled = !!(assist && assist.enabled === true);
  const required = !!(assist && assist.required === true);
  const identityOk = host && host.identity === OCR_IDENTITY;
  if (!identityOk) {
    return {
      outcome: "UNAVAILABLE",
      reason: "typed_capability_gap",
      capability: undefined,
      declared: { enabled, required, available: false },
    };
  }
  return {
    outcome: "READY",
    capability: OCR_IDENTITY,
    declared: {
      enabled,
      required,
      available: host.available === true,
    },
  };
}

function planFromDeclaration(declaration) {
  return coverage.planCoverage({
    capability: declaration.capability,
    candidate,
    declared: declaration.declared,
  });
}

describe("#114 frozen snapshot to Reviewer packet", () => {
  it("instructs the parent controller to declare from the frozen snapshot, not the live catalog", () => {
    assert.match(
      REVIEW_CAP_MD,
      /frozen(?:\s+Lifecycle)?\s+snapshot/i,
    );
    assert.match(REVIEW_CAP_MD, /never from the live catalog/i);
    assert.match(
      PROFILES_MD,
      /declares Reviewer and assurance packets from that\s+frozen snapshot copy/i,
    );
    assert.match(PROFILES_MD, /never from the live catalog/i);
  });

  it("states the roles-only reconciliation mechanic: re-freeze plus digest compare, or dated owner amendment", () => {
    assert.match(PROFILES_MD, /re-freez(?:e|ing)\s+the same named profile/i);
    assert.match(PROFILES_MD, /comparing SHA-256 digests/i);
    assert.match(PROFILES_MD, /dated owner-confirmed visible amendment/i);
    assert.match(PROFILES_MD, /not live-catalog hot reload/i);
  });

  it("requires OpenCodeReview identity on the packet; generic names do not hide an absent binding", () => {
    assert.match(REVIEW_CAP_MD, /OpenCodeReview \(OCR\)/);
    assert.match(REVIEW_CAP_MD, /generic capability name must not stand in/i);
    assert.match(VERIFICATION_MD, /frozen `deterministic_verification`/i);
  });

  it("keeps planning review and implementation assurance budgets separate", () => {
    assert.match(ROUTER_SKILL, /Planning review is a separate pre-dispatch gate; never consumes implementation assurance/);
    assert.match(ASSURANCE_MD, /never consumes implementation/);
    assert.match(ASSURANCE_MD, /this\s+budget never consumes the planning gate/i);
  });

  it("propagates frozen coverage_assist into the Reviewer packet and ignores later live-catalog drift", () => {
    const live = baseProfile();
    live.review = { coverage_assist: { enabled: true, required: false } };
    const frozen = profilesHook.freezeSelectedRoutes({ profile: live });

    live.review.coverage_assist.enabled = false;
    live.review.coverage_assist.required = true;

    const declaration = declareCoverageFromFrozen({
      snapshot: frozen.snapshot,
      host: { identity: OCR_IDENTITY, available: true },
    });
    assert.equal(declaration.capability, OCR_IDENTITY);
    assert.deepEqual(declaration.declared, {
      enabled: true,
      required: false,
      available: true,
    });

    const plan = planFromDeclaration(declaration);
    assert.equal(plan.outcome, "READY");
    assert.equal(plan.capability, OCR_IDENTITY);
  });

  it("reports selected-but-unavailable as a typed gap after frozen projection", () => {
    const profile = baseProfile();
    profile.review = { coverage_assist: { enabled: true, required: false } };
    const frozen = profilesHook.freezeSelectedRoutes({ profile });
    const declaration = declareCoverageFromFrozen({
      snapshot: frozen.snapshot,
      host: { identity: OCR_IDENTITY, available: false },
    });
    const plan = planFromDeclaration(declaration);
    assert.equal(plan.outcome, "UNAVAILABLE");
    assert.equal(plan.reason, "typed_capability_gap");
    assert.equal(plan.proceed, "proceed-with-note");
  });

  it("returns a typed identity gap instead of a generic capability name", () => {
    const profile = baseProfile();
    profile.review = { coverage_assist: { enabled: true, required: true } };
    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    const missing = declareCoverageFromFrozen({
      snapshot: frozen.snapshot,
      host: { identity: "coverage-tool", available: true },
    });
    assert.equal(missing.outcome, "UNAVAILABLE");
    assert.equal(missing.reason, "typed_capability_gap");
    assert.equal(missing.capability, undefined);
    assert.equal(missing.declared.available, false);

    const unnamed = declareCoverageFromFrozen({
      snapshot: frozen.snapshot,
      host: { available: true },
    });
    assert.equal(unnamed.capability, undefined);
    assert.equal(unnamed.declared.available, false);
  });

  it("treats digest mismatch after re-freeze as the roles-only / live-drift amendment signal", () => {
    const rolesOnly = baseProfile();
    const frozenOld = profilesHook.freezeSelectedRoutes({ profile: rolesOnly });
    assert.equal("review" in frozenOld.snapshot, false);

    const sameNameNowWithCapability = baseProfile();
    sameNameNowWithCapability.review = {
      coverage_assist: { enabled: true, required: false },
    };
    const frozenNew = profilesHook.freezeSelectedRoutes({
      profile: sameNameNowWithCapability,
    });
    assert.notEqual(
      frozenNew.digest,
      frozenOld.digest,
      "re-freeze digest mismatch is the amendment signal; not a live hot reload",
    );
  });
});

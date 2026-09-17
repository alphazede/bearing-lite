/**
 * Issue #114: freezeSelectedRoutes capability preservation.
 * Proves that review and deterministic_verification capability sections
 * are deep-copied into snapshot and bound to the configuration digest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));

const clone = (obj) => JSON.parse(JSON.stringify(obj));

function baseProfile() {
  return {
    roles: {
      implementer: {
        enabled: true,
        primary: {
          harness: "harness-a",
          model: "model-a",
          reasoning: "reasoning-a",
        },
        ordered_fallbacks: [],
      },
      reviewer: {
        enabled: true,
        primary: {
          harness: "harness-b",
          model: "model-b",
          reasoning: "reasoning-b",
        },
        ordered_fallbacks: [],
      },
    },
  };
}

describe("freezeSelectedRoutes capability preservation (#114)", () => {
  it("deep-copies review capability into snapshot and isolates from subsequent mutation", () => {
    const profile = baseProfile();
    profile.review = {
      coverage_assist: {
        enabled: true,
        required: false,
      },
    };

    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    assert.ok(frozen.snapshot, "snapshot must exist");
    assert.deepEqual(frozen.snapshot.review, {
      coverage_assist: {
        enabled: true,
        required: false,
      },
    });

    // Mutate input profile after freezing
    profile.review.coverage_assist.enabled = false;
    profile.review.coverage_assist.required = true;
    profile.review.extra = "mutated";

    assert.equal(
      frozen.snapshot.review.coverage_assist.enabled,
      true,
      "frozen snapshot must not reflect subsequent input mutation"
    );
    assert.equal(
      frozen.snapshot.review.coverage_assist.required,
      false,
      "frozen snapshot must not reflect subsequent input mutation"
    );
    assert.equal(
      frozen.snapshot.review.extra,
      undefined,
      "frozen snapshot must not receive new properties added after freeze"
    );
  });

  it("deep-copies deterministic_verification capability into snapshot and isolates from subsequent mutation", () => {
    const profile = baseProfile();
    profile.deterministic_verification = {
      reverify: {
        enabled: true,
      },
    };

    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    assert.ok(frozen.snapshot, "snapshot must exist");
    assert.deepEqual(frozen.snapshot.deterministic_verification, {
      reverify: {
        enabled: true,
      },
    });

    // Mutate input profile after freezing
    profile.deterministic_verification.reverify.enabled = false;
    profile.deterministic_verification.reverify.extra = "mutated";

    assert.equal(
      frozen.snapshot.deterministic_verification.reverify.enabled,
      true,
      "frozen snapshot must not reflect subsequent input mutation"
    );
    assert.equal(
      frozen.snapshot.deterministic_verification.reverify.extra,
      undefined,
      "frozen snapshot must not receive new properties added after freeze"
    );
  });

  it("capability selection changes the configuration digest", () => {
    const baseline = baseProfile();
    const frozenBaseline = profilesHook.freezeSelectedRoutes({ profile: baseline });

    const withReview = baseProfile();
    withReview.review = {
      coverage_assist: {
        enabled: true,
        required: false,
      },
    };
    const frozenWithReview = profilesHook.freezeSelectedRoutes({ profile: withReview });

    assert.notEqual(
      frozenWithReview.digest,
      frozenBaseline.digest,
      "selecting review capability must change configuration digest"
    );

    const withVerification = baseProfile();
    withVerification.deterministic_verification = {
      reverify: {
        enabled: true,
      },
    };
    const frozenWithVerification = profilesHook.freezeSelectedRoutes({
      profile: withVerification,
    });

    assert.notEqual(
      frozenWithVerification.digest,
      frozenBaseline.digest,
      "selecting deterministic_verification capability must change configuration digest"
    );

    assert.notEqual(
      frozenWithReview.digest,
      frozenWithVerification.digest,
      "distinct capabilities must produce distinct configuration digests"
    );

    // Changing capability value changes digest
    const withReviewDisabled = baseProfile();
    withReviewDisabled.review = {
      coverage_assist: {
        enabled: false,
        required: false,
      },
    };
    const frozenWithReviewDisabled = profilesHook.freezeSelectedRoutes({
      profile: withReviewDisabled,
    });

    assert.notEqual(
      frozenWithReviewDisabled.digest,
      frozenWithReview.digest,
      "changing capability enabled value must change configuration digest"
    );
  });

  it("subsequent input mutation leaves frozen digest unchanged", () => {
    const profile = baseProfile();
    profile.review = {
      coverage_assist: {
        enabled: true,
        required: false,
      },
    };
    profile.deterministic_verification = {
      reverify: {
        enabled: true,
      },
    };

    const frozen = profilesHook.freezeSelectedRoutes({ profile });
    const originalDigest = frozen.digest;

    profile.review.coverage_assist.enabled = false;
    profile.deterministic_verification.reverify.enabled = false;

    assert.equal(
      frozen.digest,
      originalDigest,
      "mutating input profile after freeze must not alter frozen digest"
    );
  });

  it("omitted settings stay omitted in frozen snapshot", () => {
    const profile = baseProfile();
    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    assert.equal("review" in frozen.snapshot, false, "omitted review must not be present in snapshot");
    assert.equal(
      "deterministic_verification" in frozen.snapshot,
      false,
      "omitted deterministic_verification must not be present in snapshot"
    );
    assert.equal(frozen.snapshot.review, undefined);
    assert.equal(frozen.snapshot.deterministic_verification, undefined);
  });

  it("explicit disabled capability values survive into frozen snapshot", () => {
    const profile = baseProfile();
    profile.review = {
      coverage_assist: {
        enabled: false,
        required: false,
      },
    };
    profile.deterministic_verification = {
      reverify: {
        enabled: false,
      },
    };

    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    assert.deepEqual(frozen.snapshot.review, {
      coverage_assist: {
        enabled: false,
        required: false,
      },
    });
    assert.deepEqual(frozen.snapshot.deterministic_verification, {
      reverify: {
        enabled: false,
      },
    });
  });

  it("retains legacy roles-only digest when no capabilities are present", () => {
    const profile = baseProfile();
    const frozen = profilesHook.freezeSelectedRoutes({ profile });

    // Calculate expected legacy digest directly from roles
    const crypto = require("node:crypto");
    const canonicalJson = (val) => {
      if (val === null || typeof val !== "object") return JSON.stringify(val);
      if (Array.isArray(val)) return "[" + val.map(canonicalJson).join(",") + "]";
      const keys = Object.keys(val).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(val[k])).join(",") + "}";
    };
    const expectedLegacyDigest = crypto
      .createHash("sha256")
      .update(canonicalJson(profile.roles), "utf8")
      .digest("hex");

    assert.equal(
      frozen.digest,
      expectedLegacyDigest,
      "roles-only profile must produce byte-identical digest to legacy roles-only digest"
    );
  });

  it("digest excludes excluded keys (cadence, route, authority) inside capabilities", () => {
    const baseline = baseProfile();
    baseline.review = {
      coverage_assist: {
        enabled: true,
        required: false,
      },
    };
    const frozenBaseline = profilesHook.freezeSelectedRoutes({ profile: baseline });

    const withExcludedKey = baseProfile();
    withExcludedKey.review = {
      coverage_assist: {
        enabled: true,
        required: false,
        cadence: "lifecycle",
        route: "should-be-excluded",
        authority: "should-be-excluded",
      },
    };
    const frozenWithExcludedKey = profilesHook.freezeSelectedRoutes({
      profile: withExcludedKey,
    });

    assert.equal(
      frozenWithExcludedKey.digest,
      frozenBaseline.digest,
      "excluded keys (cadence, route, authority) must not affect configuration digest"
    );
  });
});

/**
 * Fellow role in the public profile schema and evaluator (Bearing 3.0 S05T,
 * test-first for S05). Role-only public data: DEC-31 replaced per-route
 * capability tiers, so no tier field is accepted anywhere.
 * Oracles: B30-124..B30-129 (public side), DES-F19 (the schema accepts a
 * `fellow` role key; the closed roots admit nothing else new), boundary
 * contract F16 (roles.fellow uses the existing enabled/primary/ordered_fallbacks
 * route shape; no capability_tier or capability_tiers; freeze copies it like
 * other roles). SEIT: SEIT-B30-127, SEIT-F03 (Fellow rows), SEIT-TB02-N.
 * Public entry points: schemas/profiles.schema.json through a Draft 2020-12
 * validator, and hooks/profiles.cjs exports.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const SCHEMA_PATH = path.join(ROOT, "schemas/profiles.schema.json");
const FIXTURE_PATH = path.join(ROOT, "test/fixtures/profiles-populated.example.json");

// Synthetic owner-set Fellow route; never a real catalog value.
const FELLOW = Object.freeze({
  enabled: true,
  primary: { harness: "harness-fellow", model: "model-fellow", reasoning: "reasoning-fellow" },
  ordered_fallbacks: [
    { condition: "condition-fellow-first", harness: "harness-fellow-b", model: "model-fellow-b", reasoning: "reasoning-fellow-b" },
    { condition: "condition-fellow-second", harness: "harness-fellow-c", model: "model-fellow-c", reasoning: "reasoning-fellow-c" },
  ],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Catalog with fixture-alpha only (a legacy profile without Fellow). */
function legacyCatalog() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  return { schema_version: 1, profiles: { "fixture-alpha": clone(fixture.profiles["fixture-alpha"]) } };
}

function fellowCatalog(route = FELLOW) {
  const doc = legacyCatalog();
  doc.profiles["fixture-alpha"].roles.fellow = clone(route);
  return doc;
}

/**
 * Draft 2020-12 verdicts from the pinned test-only Python validator
 * (test/schema-validator-requirements.txt). Uses the isolated root when set.
 * Returns null when no validator is importable (reported as a skip, not a pass).
 */
const VALIDATE_PY = `
import json, os, sys
root = os.environ.get("BEARING_LITE_SCHEMA_ISOLATED_ROOT")
if root: sys.path.insert(0, root)
try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("NO_VALIDATOR"); sys.exit(0)
schema = json.load(open(sys.argv[1], encoding="utf-8"))
docs = json.load(open(sys.argv[2], encoding="utf-8"))
v = Draft202012Validator(schema)
print(json.dumps([sorted(".".join(map(str, e.absolute_path)) + ": " + e.message for e in v.iter_errors(d)) for d in docs]))
`;

function schemaVerdicts(t, docs) {
  const dir = mkdtempSync(path.join(tmpdir(), "profiles-fellow-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const docsPath = path.join(dir, "docs.json");
  writeFileSync(docsPath, JSON.stringify(docs));
  const r = spawnSync("python3", ["-c", VALIDATE_PY, SCHEMA_PATH, docsPath], { encoding: "utf8", timeout: 30_000 });
  if (r.error || r.status !== 0) {
    t.skip(`ENVIRONMENT: python3 validator did not run: ${r.error ?? r.stderr}`);
    return null;
  }
  if (r.stdout.trim() === "NO_VALIDATOR") {
    t.skip("ENVIRONMENT: jsonschema not importable; set BEARING_LITE_SCHEMA_ISOLATED_ROOT (see test/schema-validator-requirements.txt)");
    return null;
  }
  return JSON.parse(r.stdout);
}

describe("public profile schema accepts the Fellow role (B30-127, DES-F19, SEIT-B30-127)", () => {
  it("declares roles.fellow as the ordinary closed role route, optional", () => {
    // The schema document is the published contract; consumers read roles from it.
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const roles = schema.$defs.profile.properties.roles;
    assert.equal(roles.additionalProperties, false, "roles stays a closed root");
    assert.equal(roles.properties.fellow?.$ref, "#/$defs/route", "fellow uses the existing enabled/primary/ordered_fallbacks route");
    assert.equal((roles.required ?? []).includes("fellow"), false, "legacy profiles without Fellow stay valid");
  });

  it("validates a profile with a Fellow route and a legacy profile without it; rejects a malformed Fellow route", (t) => {
    const missingPrimary = clone(FELLOW);
    delete missingPrimary.primary;
    const missingModel = clone(FELLOW);
    delete missingModel.primary.model;
    const badFallback = clone(FELLOW);
    delete badFallback.ordered_fallbacks[0].condition;
    const verdicts = schemaVerdicts(t, [
      fellowCatalog(),
      legacyCatalog(),
      fellowCatalog(missingPrimary),
      fellowCatalog(missingModel),
      fellowCatalog(badFallback),
      fellowCatalog({ ...clone(FELLOW), enabled: "yes" }),
    ]);
    if (!verdicts) return;
    assert.deepEqual(verdicts[0], [], "a profile declaring the Fellow role must validate");
    assert.deepEqual(verdicts[1], [], "a legacy profile without Fellow must keep validating");
    for (const [index, name] of [[2, "no primary"], [3, "primary without model"], [4, "fallback without condition"], [5, "non-boolean enabled"]]) {
      assert.ok(verdicts[index].length > 0, `malformed Fellow route (${name}) must be rejected`);
    }
  });

  it("admits no tier field and no other new role key (DEC-31 role-only, DES-F19 closed roots)", (t) => {
    const tierOnRoute = fellowCatalog({ ...clone(FELLOW), capability_tier: "frontier" });
    const tiersOnProfile = fellowCatalog();
    tiersOnProfile.profiles["fixture-alpha"].capability_tiers = { fellow: "frontier" };
    const tierOnRoles = fellowCatalog();
    tierOnRoles.profiles["fixture-alpha"].roles.capability_tier = "frontier";
    const otherRole = fellowCatalog();
    otherRole.profiles["fixture-alpha"].roles.advisor = clone(FELLOW);
    const verdicts = schemaVerdicts(t, [fellowCatalog(), tierOnRoute, tiersOnProfile, tierOnRoles, otherRole]);
    if (!verdicts) return;
    assert.deepEqual(verdicts[0], [], "the Fellow control profile must validate, so each rejection below is about its one change");
    for (const [index, name] of [[1, "capability_tier on the Fellow route"], [2, "capability_tiers on the profile"], [3, "capability_tier under roles"], [4, "unknown role advisor"]]) {
      assert.ok(verdicts[index].length > 0, `${name} must be rejected`);
    }
  });
});

describe("evaluator carries the Fellow route like every other role (B30-126, B30-128, F16)", () => {
  it("loads a user catalog that declares Fellow as READY", (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "profiles-fellow-home-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(path.join(home, ".agents", "bearing-lite"), { recursive: true });
    writeFileSync(path.join(home, ".agents", "bearing-lite", "profiles.json"), JSON.stringify(fellowCatalog()));
    const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
    assert.equal(state.outcome, "READY", JSON.stringify(state));
  });

  it("freezes the owner-set Fellow route unchanged, with fallback order, into the digest-bound snapshot", () => {
    const profile = fellowCatalog().profiles["fixture-alpha"];
    const frozen = profilesHook.freezeSelectedRoutes({ profile });
    assert.ok(frozen.snapshot, JSON.stringify(frozen));
    assert.deepEqual(frozen.snapshot.roles.fellow, FELLOW, "frozen Fellow route equals the owner-set route");
    assert.deepEqual(frozen.snapshot.roles.implementer, profile.roles.implementer, "other role routes are carried alongside");

    profile.roles.fellow.primary.model = "model-fellow-live-edit";
    assert.equal(frozen.snapshot.roles.fellow.primary.model, "model-fellow", "a later live catalog edit does not reach the frozen route");

    const legacy = profilesHook.freezeSelectedRoutes({ profile: legacyCatalog().profiles["fixture-alpha"] });
    assert.notEqual(frozen.digest, legacy.digest, "the Fellow route is part of the bound digest");
    const changedModel = profilesHook.freezeSelectedRoutes({ profile: fellowCatalog({ ...clone(FELLOW), primary: { ...FELLOW.primary, model: "model-fellow-other" } }).profiles["fixture-alpha"] });
    assert.notEqual(changedModel.digest, frozen.digest, "a different Fellow model gives a different digest");
    const reordered = clone(FELLOW);
    reordered.ordered_fallbacks.reverse();
    const reorderedFreeze = profilesHook.freezeSelectedRoutes({ profile: fellowCatalog(reordered).profiles["fixture-alpha"] });
    assert.notEqual(reorderedFreeze.digest, frozen.digest, "Fellow fallback order is bound");
  });

  it("never lets a Fellow route stand in for the TDD Test Implementer route", () => {
    const profile = fellowCatalog().profiles["fixture-alpha"];
    profile.development_strategy = { mode: "tdd" };
    delete profile.roles.test_implementer;
    const frozen = profilesHook.freezeSelectedRoutes({ profile });
    assert.equal(frozen.outcome, "OWNER_DECISION_REQUIRED", "missing Test Implementer still fails closed with Fellow present");
    assert.equal(frozen.snapshot, undefined);
  });

  it("ships no Fellow route in the packaged catalog (B30-124, B30-129: the route stays owner-set)", () => {
    const shipped = readFileSync(path.join(ROOT, "profiles.json"), "utf8");
    assert.equal(shipped.includes("fellow"), false);
    assert.equal(shipped, profilesHook.packagedCatalogBytes());
  });
});

/**
 * Bearing-level Fellow route in the public profile schema and evaluator
 * (Alphazedehq#579). Role-only public data: DEC-31 replaced per-route
 * capability tiers, so no tier field is accepted anywhere.
 * Oracles: B30-124..B30-129 (public side), Alphazedehq#579 (top-level optional
 * catalog `fellow` route `{ harness, model, reasoning, ordered_fallbacks }`,
 * fallback `condition` optional, `roles.fellow` removed from profile roles,
 * every freeze copies catalog `fellow` unchanged into `snapshot.fellow`
 * whatever profile is selected; absent when catalog has none).
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

// Synthetic owner-set Bearing-level Fellow route; never a real catalog value.
const FELLOW = Object.freeze({
  harness: "harness-fellow",
  model: "model-fellow",
  reasoning: "reasoning-fellow",
  ordered_fallbacks: [
    { condition: "condition-fellow-first", harness: "harness-fellow-b", model: "model-fellow-b", reasoning: "reasoning-fellow-b" },
    { harness: "harness-fellow-c", model: "model-fellow-c", reasoning: "reasoning-fellow-c" },
  ],
});

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Catalog with fixture-alpha and fixture-gamma (no catalog-level Fellow). */
function legacyCatalog() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  return {
    schema_version: 1,
    profiles: {
      "fixture-alpha": clone(fixture.profiles["fixture-alpha"]),
      "fixture-gamma": clone(fixture.profiles["fixture-gamma"]),
    },
  };
}

function fellowCatalog(route = FELLOW) {
  const doc = legacyCatalog();
  doc.fellow = clone(route);
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

describe("public profile schema accepts the Bearing-level Fellow route (Alphazedehq#579)", () => {
  it("declares optional top-level fellow and removes roles.fellow from profile roles", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const roles = schema.$defs.profile.properties.roles;
    assert.equal(roles.additionalProperties, false, "roles stays a closed root");
    assert.equal(Object.hasOwn(roles.properties, "fellow"), false, "roles.fellow is removed from profile roles");
    assert.equal(Object.hasOwn(schema.properties, "fellow"), true, "catalog envelope declares top-level fellow");
    assert.equal((schema.required ?? []).includes("fellow"), false, "catalogs without fellow stay valid");
  });

  it("validates a catalog with top-level fellow (with or without fallback condition) and without it; refuses roles.fellow and malformed fellow", (t) => {
    const missingModel = clone(FELLOW);
    delete missingModel.model;
    const missingFallbacks = clone(FELLOW);
    delete missingFallbacks.ordered_fallbacks;
    const badFallback = clone(FELLOW);
    delete badFallback.ordered_fallbacks[0].harness;
    const withRolesFellow = legacyCatalog();
    withRolesFellow.profiles["fixture-alpha"].roles.fellow = {
      enabled: true,
      primary: { harness: "harness-fellow", model: "model-fellow", reasoning: "reasoning-fellow" },
      ordered_fallbacks: [],
    };
    const emptyFallbacks = clone(FELLOW);
    emptyFallbacks.ordered_fallbacks = [];

    const verdicts = schemaVerdicts(t, [
      fellowCatalog(),
      legacyCatalog(),
      fellowCatalog(emptyFallbacks),
      withRolesFellow,
      fellowCatalog(missingModel),
      fellowCatalog(missingFallbacks),
      fellowCatalog(badFallback),
      fellowCatalog({ ...clone(FELLOW), enabled: true }),
    ]);
    if (!verdicts) return;
    assert.deepEqual(verdicts[0], [], "a catalog declaring top-level fellow must validate");
    assert.deepEqual(verdicts[1], [], "a catalog without fellow must keep validating");
    assert.deepEqual(verdicts[2], [], "top-level fellow with empty ordered_fallbacks must validate");
    for (const [index, name] of [
      [3, "roles.fellow inside a profile"],
      [4, "top-level fellow without model"],
      [5, "top-level fellow without ordered_fallbacks"],
      [6, "fallback without harness"],
      [7, "unexpected enabled field on top-level fellow"],
    ]) {
      assert.ok(verdicts[index].length > 0, `${name} must be rejected`);
    }
  });

  it("admits no tier field and no other new role key (DEC-31 role-only, DES-F19 closed roots)", (t) => {
    const tierOnFellow = fellowCatalog({ ...clone(FELLOW), capability_tier: "frontier" });
    const tiersOnProfile = fellowCatalog();
    tiersOnProfile.profiles["fixture-alpha"].capability_tiers = { implementer: "frontier" };
    const tierOnRoles = fellowCatalog();
    tierOnRoles.profiles["fixture-alpha"].roles.capability_tier = "frontier";
    const otherRole = fellowCatalog();
    otherRole.profiles["fixture-alpha"].roles.advisor = {
      enabled: true,
      primary: { harness: "harness-a", model: "model-a", reasoning: "reasoning-a" },
      ordered_fallbacks: [],
    };
    const verdicts = schemaVerdicts(t, [fellowCatalog(), tierOnFellow, tiersOnProfile, tierOnRoles, otherRole]);
    if (!verdicts) return;
    assert.deepEqual(verdicts[0], [], "the Fellow control catalog must validate, so each rejection below is about its one change");
    for (const [index, name] of [
      [1, "capability_tier on top-level fellow"],
      [2, "capability_tiers on the profile"],
      [3, "capability_tier under roles"],
      [4, "unknown role advisor"],
    ]) {
      assert.ok(verdicts[index].length > 0, `${name} must be rejected`);
    }
  });
});

describe("evaluator carries catalog-level fellow into every frozen binding (Alphazedehq#579)", () => {
  it("loads a user catalog that declares top-level fellow as READY", (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "profiles-fellow-home-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(path.join(home, ".agents", "bearing-lite"), { recursive: true });
    writeFileSync(path.join(home, ".agents", "bearing-lite", "profiles.json"), JSON.stringify(fellowCatalog()));
    const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
    assert.equal(state.outcome, "READY", JSON.stringify(state));
  });

  it("freezes two different profiles from one catalog and both snapshots carry the same fellow", () => {
    const catalog = fellowCatalog();
    const frozenAlpha = profilesHook.freezeSelectedRoutes({
      profile: catalog.profiles["fixture-alpha"],
      catalog,
    });
    const frozenGamma = profilesHook.freezeSelectedRoutes({
      profile: catalog.profiles["fixture-gamma"],
      catalog,
    });
    assert.ok(frozenAlpha.snapshot, JSON.stringify(frozenAlpha));
    assert.ok(frozenGamma.snapshot, JSON.stringify(frozenGamma));
    assert.deepEqual(frozenAlpha.snapshot.fellow, FELLOW, "alpha snapshot carries catalog fellow unchanged");
    assert.deepEqual(frozenGamma.snapshot.fellow, FELLOW, "gamma snapshot carries catalog fellow unchanged");
    assert.deepEqual(frozenAlpha.snapshot.fellow, frozenGamma.snapshot.fellow, "both snapshots carry the same fellow");
    assert.deepEqual(frozenAlpha.snapshot.roles.implementer, catalog.profiles["fixture-alpha"].roles.implementer);

    catalog.fellow.model = "model-fellow-live-edit";
    catalog.fellow.ordered_fallbacks[0].model = "model-fellow-fb-live-edit";
    assert.equal(frozenAlpha.snapshot.fellow.model, "model-fellow", "later live catalog edit does not reach frozen snapshot.fellow");
    assert.equal(frozenGamma.snapshot.fellow.ordered_fallbacks[0].model, "model-fellow-b");
  });

  it("omits snapshot.fellow when the catalog has no fellow and binds fellow changes in the digest", () => {
    const noFellow = legacyCatalog();
    const frozenLegacy = profilesHook.freezeSelectedRoutes({
      profile: noFellow.profiles["fixture-alpha"],
      catalog: noFellow,
    });
    assert.equal(Object.hasOwn(frozenLegacy.snapshot, "fellow"), false, "snapshot.fellow is absent when catalog has no fellow");

    const catalog = fellowCatalog();
    const frozen = profilesHook.freezeSelectedRoutes({
      profile: catalog.profiles["fixture-alpha"],
      catalog,
    });
    assert.notEqual(frozen.digest, frozenLegacy.digest, "catalog fellow is part of the bound digest");

    const changedModel = fellowCatalog({ ...clone(FELLOW), model: "model-fellow-other" });
    const changedFreeze = profilesHook.freezeSelectedRoutes({
      profile: changedModel.profiles["fixture-alpha"],
      catalog: changedModel,
    });
    assert.notEqual(changedFreeze.digest, frozen.digest, "a different Fellow model gives a different digest");

    const reordered = clone(FELLOW);
    reordered.ordered_fallbacks.reverse();
    const reorderedCatalog = fellowCatalog(reordered);
    const reorderedFreeze = profilesHook.freezeSelectedRoutes({
      profile: reorderedCatalog.profiles["fixture-alpha"],
      catalog: reorderedCatalog,
    });
    assert.notEqual(reorderedFreeze.digest, frozen.digest, "Fellow fallback order is bound");
  });

  it("never lets a catalog fellow stand in for the TDD Test Implementer route", () => {
    const catalog = fellowCatalog();
    const profile = catalog.profiles["fixture-alpha"];
    profile.development_strategy = { mode: "tdd" };
    delete profile.roles.test_implementer;
    const frozen = profilesHook.freezeSelectedRoutes({ profile, catalog });
    assert.equal(frozen.outcome, "OWNER_DECISION_REQUIRED", "missing Test Implementer still fails closed with Fellow present");
    assert.equal(frozen.snapshot, undefined);
  });

  it("ships no Fellow route in the packaged catalog (B30-124, B30-129: the route stays owner-set)", () => {
    const shipped = readFileSync(path.join(ROOT, "profiles.json"), "utf8");
    assert.equal(shipped.includes("fellow"), false);
    assert.equal(shipped, profilesHook.packagedCatalogBytes());
  });
});

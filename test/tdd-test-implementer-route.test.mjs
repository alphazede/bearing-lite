/**
 * Issue 97: separate Test Implementer routes in TDD profiles.
 * Inputs are the committed fixture, profiles schema, hooks/profiles.cjs,
 * and the published skill/procedure text. Does not implement the classifier.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const FIXTURE_PATH = path.join(ROOT, "test/fixtures/profiles-populated.example.json");
const SCHEMA_PATH = path.join(ROOT, "schemas/profiles.schema.json");
const SKILLS = path.join(ROOT, "skills");
const FORBIDDEN_COPY_SOURCES = Object.freeze([
  "implementer",
  "test_engineer",
  "light_implementer",
  "surveyor",
  "explorer",
  "crewmate",
  "navigator",
  "park_ranger",
  "validator",
]);
const TDD_ROUTE_ACTIONS = Object.freeze(["select", "freeze", "dispatch"]);

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function identityKey(route) {
  const primary = route?.primary ?? {};
  return [primary.harness, primary.model, primary.reasoning].join("\0");
}

function fallbackKeys(route) {
  return (route?.ordered_fallbacks ?? []).map(
    (row) => [row.condition, row.harness, row.model, row.reasoning].join("\0")
  );
}

function assertFailClosedNoCopy(result, action) {
  assert.equal(result.outcome, "OWNER_DECISION_REQUIRED", action);
  assert.equal(result.onboard, true, `${action} must surface an onboard prompt`);
  assert.equal(
    FORBIDDEN_COPY_SOURCES.includes(result.copied_from),
    false,
    `${action} must not copy ${result.copied_from}`
  );
  const copied = result.route ?? result.test_implementer ?? result.copied_route;
  assert.equal(copied, undefined, `${action} must not invent a Test Implementer route`);
}

describe("Issue 97 Test Implementer TDD route", () => {
  it("schema exposes optional roles.test_implementer as a closed $ref route", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
    const roles = schema.$defs.profile.properties.roles;
    assert.equal(roles.additionalProperties, false);
    const spec = roles.properties.test_implementer;
    assert.equal(spec && spec.$ref, "#/$defs/route");
    assert.equal(roles.properties.implementer.$ref, "#/$defs/route");
    assert.equal((roles.required ?? []).includes("test_implementer"), false);
  });

  it("fixture-alpha stays single_implementer without test_implementer", () => {
    const alpha = loadFixture().profiles["fixture-alpha"];
    assert.equal(alpha.development_strategy.mode, "single_implementer");
    assert.equal("test_implementer" in alpha.roles, false);
    assert.equal(typeof alpha.roles.implementer.primary.harness, "string");
  });

  it("fixture-beta is a schema-shaped TDD profile that omits test_implementer", () => {
    const beta = loadFixture().profiles["fixture-beta"];
    assert.equal(beta.development_strategy.mode, "tdd");
    assert.equal("test_implementer" in beta.roles, false);
    assert.equal(beta.roles.implementer.enabled, true);
  });

  it("fixture-gamma carries distinct Test Implementer and Product Implementer chains", () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    assert.equal(
      /\b(Sol|Astra|Grok|Codex|Opus|gpt-5)\b/i.test(raw),
      false,
      "TDD fixture must use synthetic identities only"
    );
    const gamma = loadFixture().profiles["fixture-gamma"];
    assert.equal(gamma.development_strategy.mode, "tdd");
    const testRoute = gamma.roles.test_implementer;
    const productRoute = gamma.roles.implementer;
    assert.equal(testRoute.enabled, true);
    assert.equal(productRoute.enabled, true);
    assert.notEqual(identityKey(testRoute), identityKey(productRoute));
    assert.notDeepEqual(fallbackKeys(testRoute), fallbackKeys(productRoute));
    assert.equal(testRoute.ordered_fallbacks.length >= 1, true);
    assert.equal(productRoute.ordered_fallbacks.length >= 1, true);
    assert.notEqual(testRoute.ordered_fallbacks[0].harness, productRoute.primary.harness);
  });

  it("catalog load stays READY when a TDD profile lacks test_implementer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-tdd-ready-"));
    try {
      const home = path.join(dir, "home");
      mkdirSync(path.join(home, ".agents", "bearing-lite"), { recursive: true });
      const catalog = {
        schema_version: 1,
        profiles: { "fixture-beta": loadFixture().profiles["fixture-beta"] },
      };
      writeFileSync(
        path.join(home, ".agents", "bearing-lite", "profiles.json"),
        `${JSON.stringify(catalog)}\n`
      );
      const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(verdict.outcome, "READY");
      assert.equal(verdict.reason, "profiles_live");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("selecting, freezing, or dispatching TDD without test_implementer fails closed", () => {
    assert.equal(typeof profilesHook.evaluateTddTestImplementerRoute, "function");
    const profile = clone(loadFixture().profiles["fixture-beta"]);
    for (const action of TDD_ROUTE_ACTIONS) {
      const result = profilesHook.evaluateTddTestImplementerRoute({ profile, action });
      assertFailClosedNoCopy(result, action);
    }
  });

  it("selecting, freezing, or dispatching TDD with disabled test_implementer fails closed", () => {
    assert.equal(typeof profilesHook.evaluateTddTestImplementerRoute, "function");
    const profile = clone(loadFixture().profiles["fixture-gamma"]);
    profile.roles.test_implementer.enabled = false;
    for (const action of TDD_ROUTE_ACTIONS) {
      const result = profilesHook.evaluateTddTestImplementerRoute({ profile, action });
      assertFailClosedNoCopy(result, action);
    }
  });

  it("selecting, freezing, or dispatching TDD with a malformed test_implementer fails closed", () => {
    assert.equal(typeof profilesHook.evaluateTddTestImplementerRoute, "function");
    const profile = clone(loadFixture().profiles["fixture-gamma"]);
    profile.roles.test_implementer = { enabled: true };
    for (const action of TDD_ROUTE_ACTIONS) {
      const result = profilesHook.evaluateTddTestImplementerRoute({ profile, action });
      assertFailClosedNoCopy(result, action);
    }
  });

  it("single_implementer without test_implementer stays dispatchable and ignores a present route", () => {
    assert.equal(typeof profilesHook.evaluateTddTestImplementerRoute, "function");
    const alpha = clone(loadFixture().profiles["fixture-alpha"]);
    const omitted = profilesHook.evaluateTddTestImplementerRoute({
      profile: alpha,
      action: "dispatch",
    });
    assert.notEqual(omitted.outcome, "OWNER_DECISION_REQUIRED");
    const withRoute = clone(alpha);
    withRoute.roles.test_implementer = clone(
      loadFixture().profiles["fixture-gamma"].roles.test_implementer
    );
    const ignored = profilesHook.evaluateTddTestImplementerRoute({
      profile: withRoute,
      action: "dispatch",
    });
    assert.notEqual(ignored.outcome, "OWNER_DECISION_REQUIRED");
    assert.equal(ignored.used_test_implementer, false);
  });

  it("freeze copies both TDD routes and fallback order and binds a digest", () => {
    assert.equal(typeof profilesHook.freezeSelectedRoutes, "function");
    const profile = clone(loadFixture().profiles["fixture-gamma"]);
    const frozen = profilesHook.freezeSelectedRoutes({ profile });
    const snapshotRoles = frozen.snapshot?.roles ?? frozen.roles;
    assert.deepEqual(
      snapshotRoles.test_implementer.ordered_fallbacks,
      profile.roles.test_implementer.ordered_fallbacks
    );
    assert.deepEqual(
      snapshotRoles.implementer.ordered_fallbacks,
      profile.roles.implementer.ordered_fallbacks
    );
    assert.deepEqual(snapshotRoles.test_implementer.primary, profile.roles.test_implementer.primary);
    assert.deepEqual(snapshotRoles.implementer.primary, profile.roles.implementer.primary);
    assert.match(frozen.digest, /^[0-9a-f]{64}$/);
    const originalDigest = frozen.digest;
    const originalTestModel = snapshotRoles.test_implementer.primary.model;
    profile.roles.test_implementer.primary.model = "model-mutated-after-freeze";
    profile.roles.implementer.ordered_fallbacks.reverse();
    assert.equal(snapshotRoles.test_implementer.primary.model, originalTestModel);
    assert.equal(frozen.digest, originalDigest);
    const mutated = profilesHook.freezeSelectedRoutes({ profile });
    assert.notEqual(mutated.digest, originalDigest);
  });

  it("migration asks for Test Implementer and does not copy another role", () => {
    const onboard = readFileSync(path.join(SKILLS, "onboard-bearing", "SKILL.md"), "utf8");
    const profiles = readFileSync(
      path.join(SKILLS, "bearing-lite", "references", "profiles.md"),
      "utf8"
    );
    assert.match(onboard, /Test Implementer/);
    assert.match(`${onboard}\n${profiles}`, /never (?:invents? or copies|copies? or invents)|must ask/i);
    assert.equal(typeof profilesHook.evaluateTddTestImplementerRoute, "function");
    const profile = clone(loadFixture().profiles["fixture-beta"]);
    profile.roles.light_implementer = clone(profile.roles.implementer);
    profile.roles.surveyor = clone(profile.roles.implementer);
    const result = profilesHook.evaluateTddTestImplementerRoute({
      profile,
      action: "migrate",
    });
    assertFailClosedNoCopy(result, "migrate");
  });

  it("tdd author order is Test Implementer then Product Implementer from the freeze", () => {
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    const router = readFileSync(path.join(SKILLS, "bearing-lite", "SKILL.md"), "utf8");
    const profiles = readFileSync(
      path.join(SKILLS, "bearing-lite", "references", "profiles.md"),
      "utf8"
    );
    assert.match(
      implementer,
      /Test Implementer[\s\S]{0,80}before[\s\S]{0,40}Product Implementer/
    );
    assert.match(router, /Test Implementer/);
    assert.match(router, /frozen snapshot|profile_freeze/);
    assert.match(profiles, /test_implementer/);
    assert.match(profiles, /Test Implementer/);
  });

  it("same-feature parallel Test Implementer and Product Implementer is prohibited", () => {
    const profiles = readFileSync(
      path.join(SKILLS, "bearing-lite", "references", "profiles.md"),
      "utf8"
    );
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    assert.match(
      `${profiles}\n${implementer}`,
      /no parallel Test Implementer\/Product Implementer|same-feature parallel is prohibited|There is no parallel Test Implementer/i
    );
  });

  it("Test Implementer write set is tests and approved fixtures only", () => {
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    const template = readFileSync(
      path.join(SKILLS, "bearing-lite", "templates", "task.md"),
      "utf8"
    );
    assert.match(
      implementer,
      /Test Implementer may change only tests and approved fixtures/
    );
    assert.match(template, /Test Implementer write set is tests and approved fixtures only/);
    assert.doesNotMatch(template, /test-writing Implementer|Test-writing Implementer/);
  });

  it("Product Implementer write set excludes tests and must not weaken independently authored tests", () => {
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    assert.match(
      implementer,
      /Product Implementer[\s\S]{0,120}excludes tests/
    );
    assert.match(implementer, /must not weaken independently authored tests/);
  });

  it("configurable roles list Test Implementer separately from Product Implementer", () => {
    const profiles = readFileSync(
      path.join(SKILLS, "bearing-lite", "references", "profiles.md"),
      "utf8"
    );
    assert.match(profiles, /Test Implementer/);
    assert.match(profiles, /test_implementer/);
    assert.match(profiles, /Product Implementer/);
    assert.doesNotMatch(profiles, /Test-writing Implementer|test-writing Implementer/);
  });

});

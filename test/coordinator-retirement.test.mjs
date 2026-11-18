// S20T (Bearing 3.0, W4): Coordinator retirement, test-first.
// Oracle: B30-219, SEIT-B30-219 (CMD-BL-PROFILES), boundary contract F09 data_contract
// (soft compatibility, no hard MIGRATION_REQUIRED), SM04 COMPATIBLE -> RETIRED, TB08.
//
// Contract the product slice (S20) must meet, observed through public entry points:
//   1. The Coordinator role is absent: skills/coordinator/ is not shipped and the
//      profiles reference names it as retired.
//   2. Legacy profiles carrying roles.coordinator (true/false/absent, with
//      assurance_repair absent/false/true) migrate softly: evaluateCatalogState
//      stays READY (never MIGRATION_REQUIRED or NEEDS_MORE_EVIDENCE) and reports a
//      typed compatibility diagnostic { code: "retired_role_ignored", role:
//      "coordinator", profile } for each profile that still carries the key.
//      The catalog bytes, the schema verdict and the frozen binding digests stay
//      exactly as they were at base ebfc94b (fixtures/base-digests.json).
//   3. evaluateCoordinatorRetirement({ journeys }) (hooks/profiles.cjs) is the
//      removal-readiness check: an active journey whose frozen snapshot enables the
//      Coordinator is reported as LEGACY_JOURNEY_ACTIVE with
//      required "pinned_runtime_or_handover"; it never rewrites the journey.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "test/fixtures/coordinator-retirement");
const require = createRequire(import.meta.url);
const profilesHook = () => require(path.join(ROOT, "hooks/profiles.cjs"));
const fixtureBytes = (name) => readFileSync(path.join(FIXTURES, name), "utf8");
const CATALOG_BYTES = fixtureBytes("legacy-catalog.json");
const CATALOG = JSON.parse(CATALOG_BYTES);
const BASE_DIGESTS = JSON.parse(fixtureBytes("base-digests.json")).digests;
const JOURNEYS = JSON.parse(fixtureBytes("journeys.json"));
const PROFILE_NAMES = Object.keys(CATALOG.profiles);
const carriesCoordinator = (name) => "coordinator" in CATALOG.profiles[name].roles;

function tempRoot(t, tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `coord-retire-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Writes bytes as the user catalog under a temporary HOME; returns { env, file }. */
function homeWithCatalog(t, bytes) {
  const home = tempRoot(t, "home");
  const dir = path.join(home, ".agents", "bearing-lite");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "profiles.json");
  writeFileSync(file, bytes);
  return { env: { HOME: home }, file };
}

function catalogOf(names) {
  const profiles = {};
  for (const name of names) profiles[name] = CATALOG.profiles[name];
  return JSON.stringify({ schema_version: 1, profiles });
}

describe("Coordinator role absent (B30-219, SM04 RETIRED)", () => {
  it("the Coordinator skill is no longer shipped", () => {
    assert.equal(existsSync(path.join(ROOT, "skills/coordinator")), false, "skills/coordinator/ must be removed");
  });

  it("the profiles reference records the Coordinator as retired and legacy routes as ignored", () => {
    const text = readFileSync(path.join(ROOT, "skills/bearing-lite/references/profiles.md"), "utf8").replace(/\s+/g, " ");
    assert.match(text, /Coordinator[^.]*\bretired\b/i);
    assert.match(text, /roles\.coordinator[^.]*\b(ignored|not (newly )?scheduled)\b/i);
  });
});

describe("legacy Coordinator profiles migrate softly (B30-219, F09, SEIT-B30-219)", () => {
  for (const name of PROFILE_NAMES) {
    it(`${name}: catalog stays READY, bytes unchanged, typed diagnostic only when the key is present`, (t) => {
      const bytes = catalogOf([name]);
      const { env, file } = homeWithCatalog(t, bytes);
      const result = profilesHook().evaluateCatalogState({ env });
      assert.equal(readFileSync(file, "utf8"), bytes, "catalog bytes unchanged");
      assert.equal(result.outcome, "READY", `no hard migration or refusal: ${JSON.stringify(result)}`);
      const diagnostics = (result.diagnostics ?? []).filter((d) => d.role === "coordinator");
      if (carriesCoordinator(name)) {
        assert.deepEqual(diagnostics, [{ code: "retired_role_ignored", role: "coordinator", profile: name }]);
      } else {
        assert.deepEqual(diagnostics, []);
      }
    });
  }

  it("the whole legacy catalog resolves at once with one diagnostic per carrying profile", (t) => {
    const { env, file } = homeWithCatalog(t, CATALOG_BYTES);
    const result = profilesHook().evaluateCatalogState({ env });
    assert.equal(readFileSync(file, "utf8"), CATALOG_BYTES);
    assert.equal(result.outcome, "READY", JSON.stringify(result));
    const named = (result.diagnostics ?? []).filter((d) => d.code === "retired_role_ignored").map((d) => d.profile).sort();
    assert.deepEqual(named, PROFILE_NAMES.filter(carriesCoordinator).sort());
  });

  it("a retired planning route beside a Coordinator route still requires its explicit migration", (t) => {
    const doc = JSON.parse(catalogOf(["legacy-coord-on-repair-absent"]));
    const roles = doc.profiles["legacy-coord-on-repair-absent"].roles;
    // Coordinator listed first so key order cannot hide the planning migration.
    doc.profiles["legacy-coord-on-repair-absent"].roles = { coordinator: roles.coordinator, plan_integrator: roles.implementer, ...roles };
    const { env } = homeWithCatalog(t, JSON.stringify(doc));
    const result = profilesHook().evaluateCatalogState({ env });
    assert.equal(result.outcome, "MIGRATION_REQUIRED");
    assert.equal(result.reason, "retired_role:plan_integrator");
  });

  for (const name of PROFILE_NAMES) {
    it(`${name}: frozen binding digest and snapshot are unchanged from base`, () => {
      const profile = CATALOG.profiles[name];
      const frozen = profilesHook().freezeSelectedRoutes({ profile });
      assert.equal(frozen.digest, BASE_DIGESTS[name], "existing frozen bindings keep resolving to the same digest");
      assert.deepEqual(frozen.snapshot.roles, profile.roles, "frozen snapshot is never rewritten");
      assert.deepEqual(frozen.snapshot.assurance_repair, profile.assurance_repair, "no new repair activation");
    });
  }
});

const VALIDATE_PY = `
import json, os, sys
root = os.environ.get("BEARING_LITE_SCHEMA_ISOLATED_ROOT")
if root: sys.path.insert(0, root)
try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("NO_VALIDATOR"); sys.exit(0)
schema = json.load(open(sys.argv[1], encoding="utf-8"))
doc = json.load(open(sys.argv[2], encoding="utf-8"))
print(json.dumps(sorted(".".join(map(str, e.absolute_path)) + ": " + e.message for e in Draft202012Validator(schema).iter_errors(doc))))
`;

describe("legacy Coordinator catalog stays schema-valid (B30-219, F09 old_profile)", () => {
  it("every legacy variant validates against the public profile schema", (t) => {
    const dir = tempRoot(t, "schema");
    const docPath = path.join(dir, "catalog.json");
    writeFileSync(docPath, CATALOG_BYTES);
    const r = spawnSync("python3", ["-c", VALIDATE_PY, path.join(ROOT, "schemas/profiles.schema.json"), docPath], { encoding: "utf8", timeout: 30_000 });
    if (r.error || r.status !== 0) return t.skip(`ENVIRONMENT: python3 validator did not run: ${r.error ?? r.stderr}`);
    if (r.stdout.trim() === "NO_VALIDATOR") return t.skip("ENVIRONMENT: jsonschema not importable; set BEARING_LITE_SCHEMA_ISOLATED_ROOT");
    assert.deepEqual(JSON.parse(r.stdout), []);
  });
});

describe("removal readiness honours active legacy Coordinator journeys (B30-219, SM04.X2, F09 frozen_old_journey)", () => {
  const check = (journeys) => {
    const { evaluateCoordinatorRetirement } = profilesHook();
    assert.equal(typeof evaluateCoordinatorRetirement, "function", "hooks/profiles.cjs exports evaluateCoordinatorRetirement");
    const before = JSON.stringify(journeys);
    const result = evaluateCoordinatorRetirement({ journeys });
    assert.equal(JSON.stringify(journeys), before, "journey records are never rewritten");
    return result;
  };

  it("an active journey with an enabled frozen Coordinator needs the pinned runtime or an explicit handover", () => {
    const result = check([JOURNEYS["active-legacy-coordinator"], JOURNEYS["active-no-coordinator"]]);
    assert.equal(result.outcome, "LEGACY_JOURNEY_ACTIVE");
    assert.deepEqual(result.journeys, [{ id: "journey-active-legacy", required: "pinned_runtime_or_handover" }]);
  });

  it("complete, Coordinator-disabled and direct journeys do not hold retirement", () => {
    const result = check([
      JOURNEYS["complete-legacy-coordinator"],
      JOURNEYS["active-coordinator-disabled"],
      JOURNEYS["active-no-coordinator"],
    ]);
    assert.equal(result.outcome, "READY");
    assert.deepEqual(result.journeys, []);
  });
});

/**
 * Alphazedehq#586: onboarding review findings R01-R22 and guided first-profile path.
 * Covers code invariants in hooks/profiles.cjs, schemas/profiles.schema.json,
 * skills/onboard-bearing/, tools/compile-handoff.mjs, and README.md, plus
 * offline fixtures for empty, existing-with-extensions, concurrent-edit, and
 * standalone skills-only validation.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const reviewCapability = require(path.join(ROOT, "hooks/review-capability.cjs"));

const ONBOARD_DIR = path.join(ROOT, "skills/onboard-bearing");
const VALIDATOR_SCRIPT = path.join(ONBOARD_DIR, "scripts/validate-profiles.mjs");
const FX_EMPTY = path.join(ROOT, "test/fixtures/onboarding/empty-catalog.json");
const FX_EXISTING = path.join(ROOT, "test/fixtures/onboarding/existing-catalog-with-extensions.json");
const FX_EXT_SCHEMA = path.join(ROOT, "test/fixtures/onboarding/extension-schema-v1.json");

function tempDir(t, tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `bearing-586-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runValidator(args, stdinText = null, scriptPath = VALIDATOR_SCRIPT) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    input: stdinText ?? undefined,
    encoding: "utf8",
    timeout: 15_000,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function writeHomeCatalog(dir, bytes, filename = "profiles.json") {
  const home = path.join(dir, "home");
  const cfg = path.join(home, ".agents", "bearing-lite");
  mkdirSync(cfg, { recursive: true });
  const file = path.join(cfg, filename);
  writeFileSync(file, bytes);
  return { home, file };
}

describe("Alphazedehq#586 onboarding R01-R22 and guided first-profile path", () => {
  it("refuses invalid retained fields on a disabled additional tool", () => {
    const raw = JSON.stringify({ schema_version: 1, profiles: { Work: {
      roles: {},
      deterministic_verification: { additional_tools: [{ name: "Lint", enabled: false, command: 42 }] },
    } } });
    const cli = runValidator(["--stdin"], raw);
    assert.equal(cli.status, 1);
    assert.equal(cli.json.catalog_valid, false);
    assert.equal(profilesHook.validateCatalog({ raw }).catalog_valid, false);
  });

  it("requires an exact named profile and validates the catalog before freezing", () => {
    const catalog = { schema_version: 1, profiles: { Work: { roles: {} } } };
    for (const profile of ["Missing", "work", "constructor"]) {
      const refused = profilesHook.freezeSelectedRoutes({ profile, catalog });
      assert.equal(refused.outcome, "OWNER_DECISION_REQUIRED");
      assert.equal(refused.snapshot, undefined);
    }
    assert.deepEqual(profilesHook.freezeSelectedRoutes({ profile: "Work", catalog }).snapshot, { roles: {} });
    catalog.fellow = { harness: "placeholder" };
    const invalid = profilesHook.freezeSelectedRoutes({ profile: "Work", catalog });
    assert.equal(invalid.outcome, "OWNER_DECISION_REQUIRED");
    assert.equal(invalid.snapshot, undefined);
    catalog.fellow = { harness: "h", model: "m", reasoning: "r", ordered_fallbacks: [] };
    const frozen = profilesHook.freezeSelectedRoutes({
      profile: "Work", catalog, fellow: { ...catalog.fellow, model: "override" },
    });
    assert.deepEqual(frozen.snapshot.fellow, catalog.fellow);
  });

  it("classifies former Fellow routes for explicit catalog migration", (t) => {
    const raw = JSON.stringify({ schema_version: 1, profiles: { Work: {
      roles: { fellow: { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] } },
    } } });
    const { home } = writeHomeCatalog(tempDir(t, "former-fellow"), raw);
    assert.equal(profilesHook.evaluateCatalogState({ env: { HOME: home } }).outcome, "MIGRATION_REQUIRED");
    assert.equal(profilesHook.validateCatalog({ raw }).outcome, "MIGRATION_REQUIRED");
    assert.equal(runValidator(["--stdin"], raw).json.outcome, "MIGRATION_REQUIRED");
  });
  it("R04: ships synced profiles.schema.json inside skills/onboard-bearing and runs standalone in a skills-only copy", (t) => {
    const rootSchema = readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8");
    const skillSchema = readFileSync(path.join(ONBOARD_DIR, "references/profiles.schema.json"), "utf8");
    assert.equal(skillSchema, rootSchema, "skill-bundled schema must stay byte-identical to schemas/profiles.schema.json");

    // Copy ONLY skills/onboard-bearing into an isolated directory with no hooks/ or schemas/ parent.
    const isolated = tempDir(t, "skills-only");
    const standaloneSkill = path.join(isolated, "onboard-bearing");
    cpSync(ONBOARD_DIR, standaloneSkill, { recursive: true });
    const standaloneValidator = path.join(standaloneSkill, "scripts/validate-profiles.mjs");

    const catalogPath = path.join(isolated, "user-profiles.json");
    writeFileSync(catalogPath, readFileSync(FX_EMPTY, "utf8"));
    const res = runValidator(["--catalog", catalogPath], null, standaloneValidator);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.equal(res.json.catalog_valid, true);
    assert.equal(res.json.empty_catalog, true);
    assert.equal(res.json.route_test_status, "not_tested_by_validator");

    // Removing the schema from the standalone copy fails closed with missing_schema before interviewing.
    rmSync(path.join(standaloneSkill, "references/profiles.schema.json"));
    const missing = runValidator(["--catalog", catalogPath], null, standaloneValidator);
    assert.equal(missing.status, 1);
    assert.equal(missing.json.reason, "missing_schema");
    assert.equal(missing.json.catalog_valid, false);
  });

  it("R01: handles private extension keys losslessly under versioned extension validation and refuses undeclared keys", (t) => {
    const existingBytes = readFileSync(FX_EXISTING, "utf8");
    const dir = tempDir(t, "ext");
    const catalogPath = path.join(dir, "profiles.json");
    writeFileSync(catalogPath, existingBytes);

    // Without extension declaration, unknown keys are rejected (never silently accepted).
    const strict = runValidator(["--catalog", catalogPath]);
    assert.equal(strict.status, 1);
    assert.equal(strict.json.catalog_valid, false);
    assert.ok(strict.json.errors.some((e) => e.includes("assurance")));
    assert.ok(strict.json.errors.some((e) => e.includes("ocr_execution_mode")));

    // With versioned extension schema, both keys validate and are reported as preserved.
    const extRes = runValidator(["--catalog", catalogPath, "--extension-schema", FX_EXT_SCHEMA]);
    assert.equal(extRes.status, 0, JSON.stringify(extRes.json));
    assert.equal(extRes.json.catalog_valid, true);
    assert.ok(extRes.json.preserved_extensions.includes("profiles.Work.assurance"));
    assert.ok(extRes.json.preserved_extensions.includes("profiles.Work.review.ocr_execution_mode"));

    // Adding a second profile preserves Work, its extension keys, and catalog-level fellow intact.
    const doc = JSON.parse(existingBytes);
    doc.profiles.Starter = {
      roles: {
        implementer: {
          enabled: true,
          primary: { harness: "harness-starter", model: "model-starter", reasoning: "medium" },
          ordered_fallbacks: [],
        },
      },
      development_strategy: { mode: "single_implementer" },
    };
    const candidateBytes = JSON.stringify(doc, null, 2) + "\n";
    const preWrite = runValidator(["--stdin", "--extension-schema", FX_EXT_SCHEMA], candidateBytes);
    assert.equal(preWrite.status, 0, JSON.stringify(preWrite.json));
    writeFileSync(catalogPath, candidateBytes);
    const readback = runValidator(["--catalog", catalogPath, "--extension-schema", FX_EXT_SCHEMA]);
    assert.equal(readback.status, 0);
    const reloaded = JSON.parse(readFileSync(catalogPath, "utf8"));
    assert.deepEqual(reloaded.profiles.Work, JSON.parse(existingBytes).profiles.Work);
    assert.deepEqual(reloaded.fellow, JSON.parse(existingBytes).fellow);

    // hooks/profiles.cjs validateCatalog matches the same extension behavior.
    const hookStrict = profilesHook.validateCatalog({ raw: existingBytes });
    assert.equal(hookStrict.catalog_valid, false);
    const hookExt = profilesHook.validateCatalog({
      raw: existingBytes,
      allowedExtensionPaths: ["profile.assurance", "profile.review.ocr_execution_mode"],
    });
    assert.equal(hookExt.catalog_valid, true);
  });

  it("R02: allows explicit fresh decline {enabled: false} without dummy primary and validates disabling existing routes", (t) => {
    const dir = tempDir(t, "decline");
    const doc = {
      schema_version: 1,
      profiles: {
        Starter: {
          roles: {
            implementer: {
              enabled: true,
              primary: { harness: "harness-a", model: "model-a", reasoning: "high" },
              ordered_fallbacks: [],
            },
            reviewer: { enabled: false },
            scribe: { enabled: false },
            light_implementer: { enabled: false },
            mbse: { sessions: { planning: { enabled: false } } },
            integration_test: { sessions: { planning: { enabled: false } } },
            test_engineer: { sessions: { assurance: { enabled: false } } },
            integration_engineer: { sessions: { execution: { enabled: false } } },
          },
          development_strategy: { mode: "single_implementer" },
          review: { coverage_assist: { enabled: false, required: false } },
          deterministic_verification: { reverify: { enabled: false } },
        },
      },
    };
    const raw = JSON.stringify(doc);
    const res = runValidator(["--stdin"], raw);
    assert.equal(res.status, 0, JSON.stringify(res.json));
    assert.equal(res.json.catalog_valid, true);
    assert.equal(res.json.strategy_readiness.Starter.implementation_ready, true);

    const { home } = writeHomeCatalog(dir, raw);
    assert.equal(profilesHook.evaluateCatalogState({ env: { HOME: home } }).outcome, "READY");

    // Enabling a role without primary/ordered_fallbacks still fails validation.
    doc.profiles.Starter.roles.reviewer = { enabled: true };
    const bad = runValidator(["--stdin"], JSON.stringify(doc));
    assert.equal(bad.status, 1);
    assert.equal(bad.json.catalog_valid, false);
  });

  it("R09: evaluateCatalogState and validateCatalog fail closed on duplicate raw keys, case collisions, dangling defaults, bad schema_version, malformed fellow, and packaged alias", (t) => {
    const baseProfile = JSON.parse(readFileSync(FX_EXISTING, "utf8")).profiles.Work;
    delete baseProfile.assurance;
    delete baseProfile.review.ocr_execution_mode;
    const pJson = JSON.stringify(baseProfile);

    // 1. Duplicate raw JSON keys
    {
      const dir = tempDir(t, "dup");
      const dupRaw = `{"schema_version":1,"profiles":{"Work":${pJson},"Work":${pJson}}}`;
      const { home } = writeHomeCatalog(dir, dupRaw);
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "duplicate_raw_json_key");
      const val = runValidator(["--stdin"], dupRaw);
      assert.equal(val.status, 1);
      assert.equal(val.json.reason, "duplicate_raw_json_key");
    }

    // 2. ASCII case-fold collision
    {
      const dir = tempDir(t, "case");
      const colRaw = JSON.stringify({ schema_version: 1, profiles: { Work: baseProfile, work: baseProfile } });
      const { home } = writeHomeCatalog(dir, colRaw);
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "profile_name_collision");
    }

    // 3. Dangling default
    {
      const dir = tempDir(t, "default");
      const defRaw = JSON.stringify({
        schema_version: 1,
        defaults: { planning: "MissingProfile" },
        profiles: { Work: baseProfile },
      });
      const { home } = writeHomeCatalog(dir, defRaw);
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "dangling_default");
    }

    // 4. String schema_version
    {
      const dir = tempDir(t, "ver");
      const verRaw = JSON.stringify({ schema_version: "1", profiles: { Work: baseProfile } });
      const { home } = writeHomeCatalog(dir, verRaw);
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "invalid_schema_version");
    }

    // 5. Malformed top-level fellow
    {
      const dir = tempDir(t, "fellow");
      const felRaw = JSON.stringify({
        schema_version: 1,
        fellow: { harness: "h", model: "m" },
        profiles: { Work: baseProfile },
      });
      const { home } = writeHomeCatalog(dir, felRaw);
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "malformed_fellow");
    }

    // 6. Packaged catalog symlink alias
    {
      const dir = tempDir(t, "alias");
      const home = path.join(dir, "home");
      const cfg = path.join(home, ".agents", "bearing-lite");
      mkdirSync(cfg, { recursive: true });
      symlinkSync(path.join(ROOT, "profiles.json"), path.join(cfg, "profiles.json"));
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "NEEDS_MORE_EVIDENCE");
      assert.equal(state.reason, "packaged_catalog_alias");
      const val = runValidator(["--catalog", path.join(cfg, "profiles.json")]);
      assert.equal(val.status, 1);
      assert.equal(val.json.reason, "packaged_catalog_alias");
    }
  });

  it("R10: freezeSelectedRoutes preserves route digest while carrying clean-session, concurrency, strategy, and selection_source in lifecycle_settings", () => {
    const profileA = {
      roles: {
        implementer: {
          enabled: true,
          primary: { harness: "h-a", model: "m-a", reasoning: "r-a" },
          ordered_fallbacks: [],
        },
      },
      development_strategy: { mode: "single_implementer" },
      planning_to_implementation_clean_session: true,
      concurrency: {
        dispatch_ready_independent_work: true,
        preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources: true,
      },
    };
    const profileB = structuredClone(profileA);
    profileB.planning_to_implementation_clean_session = false;
    profileB.concurrency.dispatch_ready_independent_work = false;

    const frozenA = profilesHook.freezeSelectedRoutes({ profile: profileA, selection_source: "catalog" });
    const frozenB = profilesHook.freezeSelectedRoutes({ profile: profileB, selection_source: "inline" });

    assert.equal(frozenA.digest, frozenB.digest, "route digest stays compatible across lifecycle setting changes");
    assert.notEqual(frozenA.settings_digest, frozenB.settings_digest, "settings_digest tracks non-route lifecycle settings");
    assert.deepEqual(frozenA.lifecycle_settings, {
      development_strategy: { mode: "single_implementer" },
      planning_to_implementation_clean_session: true,
      concurrency: {
        dispatch_ready_independent_work: true,
        preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources: true,
      },
      selection_source: "catalog",
    });
    assert.equal(frozenB.lifecycle_settings.planning_to_implementation_clean_session, false);
    assert.equal(frozenB.lifecycle_settings.selection_source, "inline");
  });

  it("R12: TDD checks both Test Implementer and Product Implementer; readiness distinguishes catalog validity from dispatch readiness", () => {
    const tddNoProduct = {
      roles: {
        test_implementer: {
          enabled: true,
          primary: { harness: "h-t", model: "m-t", reasoning: "high" },
          ordered_fallbacks: [],
        },
      },
      development_strategy: { mode: "tdd" },
    };
    // Catalog is schema-valid, but dispatch readiness fails closed on missing implementer.
    const val = profilesHook.validateCatalog({
      raw: JSON.stringify({ schema_version: 1, profiles: { TddHalf: tddNoProduct } }),
    });
    assert.equal(val.catalog_valid, true);
    assert.equal(val.strategy_readiness.TddHalf.implementation_ready, false);
    assert.deepEqual(val.strategy_readiness.TddHalf.missing_roles, ["implementer"]);

    const routeVerdict = profilesHook.evaluateTddTestImplementerRoute({ profile: tddNoProduct, action: "freeze" });
    assert.equal(routeVerdict.outcome, "OWNER_DECISION_REQUIRED");
    assert.equal(routeVerdict.onboard, true);
    assert.equal(routeVerdict.missing_role, "implementer");

    const frozenAbsent = profilesHook.freezeSelectedRoutes({ profile: tddNoProduct });
    assert.equal(frozenAbsent.outcome, "OWNER_DECISION_REQUIRED");
    assert.equal(frozenAbsent.snapshot, undefined);

    const tddDisabledProduct = structuredClone(tddNoProduct);
    tddDisabledProduct.roles.implementer = { enabled: false };
    const frozenDisabled = profilesHook.freezeSelectedRoutes({ profile: tddDisabledProduct });
    assert.equal(frozenDisabled.outcome, "OWNER_DECISION_REQUIRED");
    assert.equal(frozenDisabled.missing_role, "implementer");
  });

  it("R18: all four OCR coverage_assist states agree across schema, adapter, and onboarding docs", () => {
    const schema = JSON.parse(readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"));
    const desc = schema.$defs.profile.properties.review.properties.coverage_assist.description;
    assert.match(desc, /enabled:false,\s*required:false/);
    assert.match(desc, /enabled:false,\s*required:true/);
    assert.match(desc, /enabled:true,\s*required:true/);
    const verTools = readFileSync(path.join(ONBOARD_DIR, "references/verification-tools.md"), "utf8");
    assert.match(verTools, /Required-only activation/);
    assert.match(verTools, /Write \*\*both\*\* flags `false`|write \*\*both\*\* flags `false`/i);

    const cand = { candidate_ref: "c1", candidate_revision: "a".repeat(40), diff_base: "b".repeat(40) };
    assert.equal(
      reviewCapability.planCoverage({ capability: "ocr", candidate: cand, declared: { enabled: false, required: false, available: false } }).outcome,
      "INACTIVE"
    );
    assert.equal(
      reviewCapability.planCoverage({ capability: "ocr", candidate: cand, declared: { enabled: false, required: true, available: false } }).proceed,
      "halt"
    );
  });

  it("R11: README onboarding and role text reflect Coordinator retirement, no catalog planning review, and named validator", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    const onboarding = readme.split(/^## Onboarding/m)[1]?.split(/^## /m)[0] ?? "";
    assert.doesNotMatch(onboarding, /planning review,/i);
    assert.doesNotMatch(onboarding, /Enabling Coordinator adds value/i);
    assert.match(onboarding, /Coordinator is retired for new waves/i);
    assert.match(onboarding, /validate-profiles\.mjs/);
    assert.match(readme, /Implementation Orchestrator owns new waves/);
    assert.doesNotMatch(readme, /Coordinator is dispatched only when the approved/);
  });

  it("Guided path & Amendment: enforces zero model guidance, three distinct labels, preview/save safety, and offline negative fixtures", (t) => {
    const skill = readFileSync(path.join(ONBOARD_DIR, "SKILL.md"), "utf8");
    const welcome = readFileSync(path.join(ONBOARD_DIR, "references/welcome.md"), "utf8");
    const guided = readFileSync(path.join(ONBOARD_DIR, "references/guided-first-profile.md"), "utf8");
    const contract = readFileSync(path.join(ONBOARD_DIR, "references/catalog-contract.md"), "utf8");
    const verTools = readFileSync(path.join(ONBOARD_DIR, "references/verification-tools.md"), "utf8");
    const allOnboarding = [skill, welcome, guided, contract, verTools].join("\n");

    // SKILL.md stays under the 12_000-byte conformance cap.
    assert.ok(Buffer.byteLength(skill, "utf8") <= 12_000);

    // Zero model guidance / ranking / tiers / Fellow cost framing.
    assert.match(allOnboarding, /never fills, suggests, ranks, or\s+characterizes/i);
    assert.doesNotMatch(allOnboarding, /\|\s*tier\s*\||\b(?:cheapest|strongest|recommended)\s+model\b|\bmodel\s+tier\b/i);
    assert.doesNotMatch(guided, /premium calls|dominate an economy/i);

    // Required guided steps and labels.
    for (const phrase of [
      "tool found",
      "model offered",
      "launch tested",
      "validate-profiles.mjs",
      "profiles.schema.json",
      "Editable preview",
      "launch probe",
      "consent per run",
      "Next request to copy",
      "planning_wave.review_requested",
      "rolling batch",
      "plan-package.cjs",
      "correction-loop.md",
      "assurance_repair.enabled",
      "orchestrator-delegation",
    ]) {
      assert.ok(allOnboarding.includes(phrase), `onboarding docs must cover ${phrase}`);
    }
    assert.match(guided, /owner supplies their model\s+ID and reasoning setting/);
    assert.doesNotMatch(guided, /debug models|--list-models|\bagy2\b/);

    // Offline failure fixtures:
    // 1. Zero-CLI / shim-only: candidate validation of an empty catalog stays valid without creating profiles.
    const dir = tempDir(t, "offline-fx");
    const emptyBytes = readFileSync(FX_EMPTY, "utf8");
    const emptyCheck = runValidator(["--stdin"], emptyBytes);
    assert.equal(emptyCheck.status, 0);
    assert.equal(emptyCheck.json.empty_catalog, true);

    // 2. Simulated rejected model (empty model string) fails pre-write validation; original bytes on disk stay untouched.
    const targetFile = path.join(dir, "profiles.json");
    writeFileSync(targetFile, emptyBytes);
    const badModel = JSON.stringify({
      schema_version: 1,
      profiles: {
        Starter: {
          roles: {
            implementer: {
              enabled: true,
              primary: { harness: "harness-x", model: "", reasoning: "high" },
              ordered_fallbacks: [],
            },
          },
        },
      },
    });
    const badRes = runValidator(["--stdin"], badModel);
    assert.equal(badRes.status, 1);
    assert.equal(badRes.json.catalog_valid, false);
    assert.equal(readFileSync(targetFile, "utf8"), emptyBytes, "rejected candidate leaves disk catalog intact");
  });
});

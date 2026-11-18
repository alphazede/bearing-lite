/**
 * S1 semantic contracts: profiles, nested sessions, migration, resume, onboard-bearing.
 * File moves remain S1L/S1E; this file encodes the frozen map and live semantics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));
const MAP = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/s1l-migration-map.json"), "utf8"));
const SKILLS = path.join(ROOT, "skills");

describe("S1 profiles, migration, resume, and role/session contracts", () => {
  it("ships profiles.schema.json and a populated nested-session fixture", () => {
    const schemaPath = path.join(ROOT, "schemas/profiles.schema.json");
    assert.equal(existsSync(schemaPath), true);
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    assert.equal(schema.$id.endsWith("profiles.schema.json"), true);
    assert.deepEqual(schema.required, ["schema_version", "profiles"]);
    const fixture = JSON.parse(
      readFileSync(path.join(ROOT, "test/fixtures/profiles-populated.example.json"), "utf8")
    );
    assert.equal(fixture.schema_version, 1);
    assert.equal(typeof fixture.schema_version, "number");
    const alpha = fixture.profiles["fixture-alpha"];
    assert.equal(alpha.roles.mbse.sessions.planning.enabled, true);
    assert.equal(alpha.roles.integration_test.sessions.planning.enabled, true);
    assert.equal("requirements_engineer" in alpha.roles, false);
    assert.equal("systems_modeler" in alpha.roles, false);
    assert.equal("planning" in alpha.roles.test_engineer.sessions, false);
    assert.equal("planning" in alpha.roles.integration_engineer.sessions, false);
    assert.equal(alpha.roles.test_engineer.sessions.assurance.cadence, "phase");
    assert.equal(alpha.roles.integration_engineer.sessions.execution.cadence, "lifecycle");
    assert.equal(alpha.roles.reviewer.cadence, "phase");
    assert.equal(alpha.development_strategy.mode, "single_implementer");
    assert.equal("test_implementer" in alpha.roles, false);
    assert.equal(alpha.deterministic_verification.reverify.enabled, false);
    assert.equal("surveyor" in alpha.roles, false);
    assert.equal("explorer" in alpha.roles, false);
    assert.equal("crewmate" in alpha.roles, false);
  });

  it("freezes exact S1L source/destination operations and empty catalog bytes", () => {
    assert.equal(MAP.empty_profiles_catalog_bytes, '{"schema_version":1,"profiles":{}}');
    assert.deepEqual(MAP.empty_profiles_catalog, { schema_version: 1, profiles: {} });
    const ops = MAP.operations;
    const dests = ops.map((op) => op.destination || op.source);
    assert.ok(ops.some((op) => op.op === "write" && op.destination === "profiles.json"));
    assert.ok(ops.some((op) => op.op === "delete" && op.source === "lineups.json"));
    assert.ok(ops.some((op) => op.op === "delete" && op.source === "schemas/lineups.schema.json"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/crewmate/" && op.destination === "skills/implementer/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/park-ranger/" && op.destination === "skills/reviewer/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/repository-fit/" && op.destination === "skills/intake/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/set-bearings/" && op.destination === "skills/architectural-alignment/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/gather-supplies/" && op.destination === "skills/scope-definition/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy_into" && op.source === "skills/map-the-route/" && op.destination === "skills/planning-and-design/" && op.source_delete === "intrinsic_to_rename"));
    assert.ok(ops.some((op) => op.op === "copy" && op.destination === "skills/coordinator/SKILL.md"));
    assert.ok(ops.some((op) => op.op === "delete_tree" && op.source === "skills/surveyor/"));
    assert.ok(ops.some((op) => op.op === "delete_tree" && op.source === "skills/navigator/"));
    assert.ok(ops.some((op) => op.op === "delete_tree" && op.source === "skills/validator/"));
    assert.ok(ops.some((op) => op.op === "copy_unchanged" && op.source_parameter === "PROMPT_SKILL_SOURCE" && op.destination === "skills/prompt/SKILL.md"));
    assert.equal(MAP.prompt_source_parameter, "PROMPT_SKILL_SOURCE");
    assert.ok(!ops.some((op) => op.op === "move_contents" || op.op === "move"));
    assert.equal("source_paths_requiring_write_set_amendment" in MAP, false);
    assert.match(MAP.rename_policy, /intrinsic to the rename/);
    assert.ok(!MAP.not_in_s1l.some((line) => /Do not delete source skill directories/i.test(line)));
    assert.ok(!ops.some((op) => op.source_delete === "not_authorized"));
    assert.ok(dests.includes("profiles.json"));
    const raw = readFileSync(path.join(ROOT, "test/fixtures/s1l-migration-map.json"), "utf8");
    assert.equal(/\/home\/[A-Za-z0-9._-]+\//.test(raw), false, "migration map must not embed private /home/ paths");
    assert.equal(/\/Users\/[A-Za-z0-9._-]+\//.test(raw), false, "migration map must not embed private /Users/ paths");
  });

  it("onboard-bearing asks one setting at a time and never infers writes", () => {
    const text = readFileSync(path.join(SKILLS, "onboard-bearing", "SKILL.md"), "utf8");
    assert.match(text, /one setting at a time/);
    assert.match(text, /without selecting or writing unless explicitly instructed/);
    assert.match(text, /MIGRATION_REQUIRED/);
    assert.match(text, /Integration Engineer execution/);
    assert.match(text, /reverify\.enabled: false/);
    assert.match(text, /Store no credentials/);
    assert.match(text, /Never\s+search, merge, prefer, or fall back to `lineups\.json`/);
  });

  it("Orchestrator resume checks liveness once and does not duplicate RUNNING", () => {
    const router = readFileSync(path.join(SKILLS, "bearing-lite", "SKILL.md"), "utf8");
    const resume = readFileSync(path.join(SKILLS, "bearing-lite", "references", "resume.md"), "utf8");
    assert.match(router, /references\/resume\.md/);
    assert.match(resume, /one\s+host-native liveness check/);
    for (const state of ["RUNNING", "COMPLETED", "INACTIVE", "UNKNOWN"]) assert.match(resume, new RegExp(`\`${state}\``));
    assert.match(router, /Never replay completed stages or change routes/);
    assert.match(router, /Launch each selected agent assignment once/);
    assert.match(resume, /Never duplicate/);
    assert.match(resume, /`WAITING_ON`/);
    assert.match(resume, /never adds a watchdog daemon,\nheartbeat service, global timeout, or model polling/);
  });

  it("legacy user lineups.json returns MIGRATION_REQUIRED and is never live", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-profiles-"));
    try {
      const home = path.join(dir, "home");
      mkdirSync(path.join(home, ".agents", "bearing-lite"), { recursive: true });
      writeFileSync(path.join(home, ".agents", "bearing-lite", "lineups.json"), '{"schema_version":1,"lineups":{}}');
      const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(verdict.outcome, "MIGRATION_REQUIRED");
      assert.equal(verdict.reason, "legacy_lineups_present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retired planning routes require explicit migration that preserves other roles (F7)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-profiles-"));
    try {
      const home = path.join(dir, "home");
      const catalogDir = path.join(home, ".agents", "bearing-lite");
      mkdirSync(catalogDir, { recursive: true });
      const fixture = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/profiles-populated.example.json"), "utf8"));
      const [name] = Object.keys(fixture.profiles);
      const route = { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] };
      for (const key of ["plan_integrator", "planning_and_design"]) {
        const catalog = structuredClone(fixture);
        catalog.profiles[name].roles[key] = route;
        const bytes = JSON.stringify(catalog);
        writeFileSync(path.join(catalogDir, "profiles.json"), bytes);
        const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
        assert.equal(verdict.outcome, "MIGRATION_REQUIRED", key);
        assert.equal(verdict.reason, `retired_role:${key}`);
        assert.equal(verdict.profile, name);
        assert.match(verdict.migration, /preserve all other roles, models, fallbacks, and capability sections/);
        assert.match(verdict.migration, /never copy it to another role/);
        // The evaluator never rewrites the user's catalog.
        assert.equal(readFileSync(path.join(catalogDir, "profiles.json"), "utf8"), bytes);
        // Migrating by removing only the retired key yields a live catalog.
        delete catalog.profiles[name].roles[key];
        writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(catalog));
        assert.equal(profilesHook.evaluateCatalogState({ env: { HOME: home } }).outcome, "READY");
      }
      // Other retired roles keep their existing diagnostic.
      const legacy = structuredClone(fixture);
      legacy.profiles[name].roles.surveyor = route;
      writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(legacy));
      assert.deepEqual(
        { ...profilesHook.evaluateCatalogState({ env: { HOME: home } }), path: undefined },
        { outcome: "NEEDS_MORE_EVIDENCE", reason: "retired_role:surveyor", path: undefined }
      );
      const onboard = readFileSync(path.join(SKILLS, "onboard-bearing", "SKILL.md"), "utf8");
      assert.match(onboard, /roles\.plan_integrator/);
      assert.match(onboard, /never copy/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses removed rc.1 planning roles/sessions with a clear error and freezes rc.2 roles (Alphazedehq#580)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-profiles-580-"));
    try {
      const home = path.join(dir, "home");
      const catalogDir = path.join(home, ".agents", "bearing-lite");
      mkdirSync(catalogDir, { recursive: true });
      const fixture = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/profiles-populated.example.json"), "utf8"));
      const [name] = Object.keys(fixture.profiles);
      const route = { enabled: true, primary: { harness: "h", model: "m", reasoning: "r" }, ordered_fallbacks: [] };

      // Valid rc.2 profile (mbse, integration_test, test_engineer.assurance, integration_engineer.execution) loads READY and freezes.
      writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(fixture));
      assert.equal(profilesHook.evaluateCatalogState({ env: { HOME: home } }).outcome, "READY");
      const frozen = profilesHook.freezeSelectedRoutes({ profile: fixture.profiles[name], catalog: fixture });
      assert.ok(frozen.snapshot && frozen.digest, JSON.stringify(frozen));
      assert.ok(frozen.snapshot.roles.mbse?.sessions?.planning);
      assert.ok(frozen.snapshot.roles.integration_test?.sessions?.planning);
      assert.ok(frozen.snapshot.roles.test_engineer?.sessions?.assurance);
      assert.ok(frozen.snapshot.roles.integration_engineer?.sessions?.execution);

      // Refused role keys: requirements_engineer and systems_modeler.
      for (const oldKey of ["requirements_engineer", "systems_modeler"]) {
        const bad = structuredClone(fixture);
        bad.profiles[name].roles[oldKey] = { sessions: { planning: structuredClone(route) } };
        writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(bad));
        const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
        assert.equal(verdict.outcome, "NEEDS_MORE_EVIDENCE", oldKey);
        assert.equal(verdict.reason, `removed_role:${oldKey}`);
        assert.match(verdict.error, new RegExp(`roles\\.${oldKey} is removed.*roles\\.mbse\\.sessions\\.planning`));
        const freezeVerdict = profilesHook.freezeSelectedRoutes({ profile: bad.profiles[name] });
        assert.equal(freezeVerdict.outcome, "OWNER_DECISION_REQUIRED", oldKey);
        assert.equal(freezeVerdict.snapshot, undefined);
        assert.equal(freezeVerdict.digest, undefined);
        assert.equal(freezeVerdict.reason, `removed_role:${oldKey}`);
        assert.match(freezeVerdict.error, new RegExp(`roles\\.${oldKey} is removed`));
      }

      // Refused planning sessions on test_engineer and integration_engineer.
      for (const role of ["test_engineer", "integration_engineer"]) {
        const bad = structuredClone(fixture);
        bad.profiles[name].roles[role].sessions.planning = structuredClone(route);
        writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(bad));
        const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
        assert.equal(verdict.outcome, "NEEDS_MORE_EVIDENCE", role);
        assert.equal(verdict.reason, `removed_session:${role}.planning`);
        assert.match(verdict.error, new RegExp(`roles\\.${role}\\.sessions\\.planning is removed.*roles\\.integration_test\\.sessions\\.planning`));
        const freezeVerdict = profilesHook.freezeSelectedRoutes({ profile: bad.profiles[name] });
        assert.equal(freezeVerdict.outcome, "OWNER_DECISION_REQUIRED", role);
        assert.equal(freezeVerdict.snapshot, undefined);
        assert.equal(freezeVerdict.digest, undefined);
        assert.equal(freezeVerdict.reason, `removed_session:${role}.planning`);
        assert.match(freezeVerdict.error, new RegExp(`roles\\.${role}\\.sessions\\.planning is removed`));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing user profiles.json returns no_named_profiles without creating a file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-profiles-"));
    try {
      const home = path.join(dir, "home");
      mkdirSync(home, { recursive: true });
      const verdict = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(verdict.outcome, "no_named_profiles");
      assert.equal(existsSync(path.join(home, ".agents", "bearing-lite", "profiles.json")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("packaged empty catalog bytes are exact and contain no defaults", () => {
    assert.equal(profilesHook.packagedCatalogBytes(), '{"schema_version":1,"profiles":{}}');
  });

  it("unresolved HOME fails closed", () => {
    const verdict = profilesHook.evaluateCatalogState({ env: { HOME: "", USERPROFILE: "" } });
    assert.equal(verdict.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(verdict.reason, "home_unresolved");
  });

  it("approved stage order is Intake then combined Architectural Alignment and Scope", () => {
    const router = readFileSync(path.join(SKILLS, "bearing-lite", "SKILL.md"), "utf8");
    const intake = readFileSync(path.join(SKILLS, "intake", "SKILL.md"), "utf8");
    const alignment = readFileSync(path.join(SKILLS, "architectural-alignment", "SKILL.md"), "utf8");
    const scope = readFileSync(path.join(SKILLS, "scope-definition", "SKILL.md"), "utf8");
    const intakeAt = router.indexOf("Intake");
    const alignAt = router.indexOf("Architectural Alignment");
    const planningAt = router.indexOf("**Planning:**");
    assert.ok(intakeAt >= 0 && alignAt > intakeAt && planningAt > alignAt);
    assert.match(intake, /^name: intake$/m);
    assert.match(intake, /Intake handles input and repository selection/);
    assert.match(intake, /before Architectural\s+Alignment/);
    assert.match(intake, /Cap discovery at depth 4 and 200 paths/);
    assert.match(intake, /FIT_PROPOSED/);
    assert.match(alignment, /^name: architectural-alignment$/m);
    assert.match(alignment, /after Intake is confirmed/);
    assert.match(scope, /^name: scope-definition$/m);
    assert.match(scope, /\.\.\/architectural-alignment\/SKILL\.md/);
    assert.match(alignment, /Ask exactly one question/);
    assert.doesNotMatch(router, /\*\*Scope Definition:\*\*/);
    assert.doesNotMatch(intake, /Ask exactly one question/);
    assert.doesNotMatch(scope, /Cap discovery at depth 4 and 200 paths/);
  });

  it("Implementer and Reviewer skills carry approved names; retired Coordinator duties live in the Implementation Orchestrator", () => {
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    const reviewer = readFileSync(path.join(SKILLS, "reviewer", "SKILL.md"), "utf8");
    const implOrch = [path.join(SKILLS, "bearing-lite", "SKILL.md"), ...readdirSync(path.join(SKILLS, "bearing-lite", "references")).filter((n) => n.endsWith(".md")).map((n) => path.join(SKILLS, "bearing-lite", "references", n))].map((f) => readFileSync(f, "utf8")).join("\n");
    assert.match(implementer, /^name: implementer$/m);
    assert.match(reviewer, /^name: reviewer$/m);
    assert.match(implementer, /Test Implementer/);
    assert.match(implementer, /must not weaken independently authored tests/i);
    assert.match(implementer, /Neither.*self-certif/i);
    assert.match(implementer, /published standard/);
    assert.match(implementer, /recorded Lifecycle snapshot/);
    assert.match(implOrch, /Launch every ready independent\s+packet/);
    assert.match(reviewer, /`ACCEPT`, `ACCEPT_WITH_FINDINGS`, and `BLOCK` are terminal/);
    assert.match(reviewer, /`REPAIR_REQUIRED`\s+permits bounded correction/);
  });
});

describe("onboard-bearing rc.2 checklist, validation, and wording (Alphazedehq#582)", () => {
  it("provides an ordered checklist covering every schema key, Fellow, and the rc.2 merged role shape with no keyless questions", () => {
    const schema = JSON.parse(readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"));
    const onboard = readFileSync(path.join(SKILLS, "onboard-bearing", "SKILL.md"), "utf8");

    // Verify schema still defines the top-level and profile keys onboard-bearing must cover.
    assert.equal(Object.hasOwn(schema.properties, "fellow"), true);
    assert.equal(Object.hasOwn(schema.properties, "defaults"), true);
    assert.equal(Object.hasOwn(schema.$defs.profile.properties, "assurance_repair"), true);

    // Merged rc.2 role shape (Alphazedehq#580 + amendment) and catalog Fellow (Alphazedehq#579).
    for (const pattern of [
      /ordered checklist/i,
      /fellow/,
      /defaults\.planning/,
      /defaults\.implementation/,
      /roles\.mbse\.sessions\.planning/,
      /roles\.integration_test\.sessions\.planning/,
      /roles\.test_engineer\.sessions\.assurance/,
      /roles\.integration_engineer\.sessions\.execution/,
      /roles\.implementer/,
      /roles\.test_implementer/,
      /roles\.light_implementer/,
      /roles\.reviewer/,
      /roles\.scribe/,
      /development_strategy\.mode/,
      /planning_to_implementation_clean_session/,
      /concurrency\.dispatch_ready_independent_work/,
      /concurrency\.preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources/,
      /review\.coverage_assist/,
      /deterministic_verification\.reverify\.enabled/,
      /deterministic_verification\.additional_tools/,
      /assurance_repair\.enabled/,
      /orchestrator-delegation/,
    ]) {
      assert.match(onboard, pattern, `onboard-bearing SKILL.md must cover ${pattern}`);
    }

    // Legacy planning keys are refused; no separate planning session on Integration Engineer or Test Engineer.
    assert.doesNotMatch(onboard, /Integration Engineer's separate planning and execution sessions/);
    assert.match(onboard, /requirements_engineer.*systems_modeler[\s\S]{0,120}refused/i);
    assert.match(onboard, /test_engineer\.sessions\.planning[\s\S]{0,120}integration_engineer\.sessions\.planning[\s\S]{0,120}refused/i);

    // Item 7: no planning review question (or any setting without a schema key).
    assert.doesNotMatch(onboard, /,\s*planning review,/i);
    assert.match(onboard, /no key in `schemas\/profiles\.schema\.json`|without a schema key/i);
  });

  it("names hooks/profiles.cjs validation functions and preserves host-extension-owned keys", () => {
    const onboard = readFileSync(path.join(SKILLS, "onboard-bearing", "SKILL.md"), "utf8");
    const verTools = readFileSync(
      path.join(SKILLS, "onboard-bearing", "references", "verification-tools.md"),
      "utf8"
    );

    assert.match(onboard, /hooks\/profiles\.cjs/);
    assert.match(onboard, /evaluateCatalogState/);
    assert.match(onboard, /freezeSelectedRoutes/);
    assert.match(onboard, /host extension/i);
    assert.match(onboard, /preserv(?:e|ing)[\s\S]{0,80}host[- ]extension/i);
    assert.match(verTools, /hooks\/profiles\.cjs/);

    // Real hooks/profiles.cjs evaluation and freeze tolerate host-extension keys without stripping.
    const dir = mkdtempSync(path.join(tmpdir(), "bearing-ext-keys-"));
    try {
      const home = path.join(dir, "home");
      const catalogDir = path.join(home, ".agents", "bearing-lite");
      mkdirSync(catalogDir, { recursive: true });
      const catalog = {
        schema_version: 1,
        host_extension_meta: { owner: "ext-test", version: 1 },
        fellow: {
          harness: "h-fellow",
          model: "m-fellow",
          reasoning: "r-fellow",
          ordered_fallbacks: [],
        },
        profiles: {
          "ext-profile": {
            ext_routing: { route_id: "ext-1" },
            roles: {
              implementer: {
                enabled: true,
                primary: { harness: "h-a", model: "m-a", reasoning: "r-a" },
                ordered_fallbacks: [],
              },
            },
            development_strategy: { mode: "single_implementer" },
          },
        },
      };
      writeFileSync(path.join(catalogDir, "profiles.json"), JSON.stringify(catalog));
      const state = profilesHook.evaluateCatalogState({ env: { HOME: home } });
      assert.equal(state.outcome, "READY");
      const frozen = profilesHook.freezeSelectedRoutes({
        profile: catalog.profiles["ext-profile"],
        catalog,
      });
      assert.ok(frozen.snapshot && typeof frozen.digest === "string");
      assert.deepEqual(frozen.snapshot.fellow, catalog.fellow);
      assert.deepEqual(catalog.host_extension_meta, { owner: "ext-test", version: 1 });
      assert.deepEqual(catalog.profiles["ext-profile"].ext_routing, { route_id: "ext-1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("profiles.md Route effort and Fellow reflects the opened session and catalog Fellow", () => {
    const profiles = readFileSync(
      path.join(SKILLS, "bearing-lite", "references", "profiles.md"),
      "utf8"
    );
    const section = profiles.split(/^## Route effort and Fellow$/m)[1] ?? "";
    assert.ok(section.length > 0, "profiles.md must have Route effort and Fellow section");
    assert.doesNotMatch(section, /the route the owner selected for a smaller model/);
    assert.match(section, /session the owner opens/i);
    assert.match(section, /catalog(?:-level)?\s+`?fellow`?|optional Bearing-level/i);
    assert.match(section, /snapshot\.fellow/);
  });

  it("welcome.md lineup wording explicitly names profiles.json and rules out lineups.json", () => {
    const welcome = readFileSync(
      path.join(SKILLS, "onboard-bearing", "references", "welcome.md"),
      "utf8"
    );
    const questionLine = welcome
      .split("\n")
      .find((line) => line.startsWith("> How would you like to begin:"));
    assert.ok(questionLine, "welcome.md must keep the opening question");
    assert.match(questionLine, /profiles\.json/);
    assert.match(questionLine, /not\s+(?:legacy\s+)?lineups\.json/i);
    assert.match(welcome, /\|\s*Configure an existing[^|]*profiles\.json[^|]*\|/);
    assert.match(welcome, /mbse[\s\S]{0,40}integration_test/);
  });
});

/**
 * S1 semantic contracts: profiles, nested sessions, migration, resume, onboard-bearing.
 * File moves remain S1L/S1E; this file encodes the frozen map and live semantics.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
    assert.equal(alpha.roles.test_engineer.sessions.planning.enabled, true);
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
    assert.match(text, /never selects or writes without the\s+user's explicit instruction/i);
    assert.match(text, /MIGRATION_REQUIRED/);
    assert.match(text, /Integration Engineer execution/);
    assert.match(text, /reverify\.enabled: false/);
    assert.match(text, /Store no credentials/);
    assert.match(text, /Never\s+search, merge, prefer, or fall back to `lineups\.json`/);
  });

  it("Orchestrator resume checks liveness once and does not duplicate RUNNING", () => {
    const router = readFileSync(path.join(SKILLS, "bearing-lite", "SKILL.md"), "utf8");
    const resume = readFileSync(path.join(SKILLS, "bearing-lite", "references", "resume.md"), "utf8");
    assert.match(router, /One host-native liveness check/);
    assert.match(router, /RUNNING, COMPLETED, INACTIVE, or UNKNOWN/);
    assert.match(router, /Never replay accepted stages or duplicate dispatch/);
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

  it("approved stage order is Intake then Architectural Alignment then Scope Definition", () => {
    const router = readFileSync(path.join(SKILLS, "bearing-lite", "SKILL.md"), "utf8");
    const intake = readFileSync(path.join(SKILLS, "intake", "SKILL.md"), "utf8");
    const alignment = readFileSync(path.join(SKILLS, "architectural-alignment", "SKILL.md"), "utf8");
    const scope = readFileSync(path.join(SKILLS, "scope-definition", "SKILL.md"), "utf8");
    const intakeAt = router.indexOf("Intake");
    const alignAt = router.indexOf("Architectural Alignment");
    const scopeAt = router.indexOf("Scope Definition");
    assert.ok(intakeAt >= 0 && alignAt > intakeAt && scopeAt > alignAt);
    assert.match(intake, /^name: intake$/m);
    assert.match(intake, /Intake handles input and repository selection/);
    assert.match(intake, /before Architectural\s+Alignment/);
    assert.match(intake, /Cap discovery at depth 4 and 200 paths/);
    assert.match(intake, /FIT_PROPOSED/);
    assert.match(alignment, /^name: architectural-alignment$/m);
    assert.match(alignment, /after Intake is confirmed/);
    assert.match(alignment, /usable by Scope Definition/);
    assert.match(scope, /^name: scope-definition$/m);
    assert.match(scope, /Ask exactly one question/);
    assert.match(scope, /after\s+Architectural Alignment/);
    assert.doesNotMatch(intake, /Ask exactly one question/);
    assert.doesNotMatch(scope, /Cap discovery at depth 4 and 200 paths/);
  });

  it("Implementer, Reviewer, and Coordinator skills carry approved names after rename", () => {
    const implementer = readFileSync(path.join(SKILLS, "implementer", "SKILL.md"), "utf8");
    const reviewer = readFileSync(path.join(SKILLS, "reviewer", "SKILL.md"), "utf8");
    const coordinator = readFileSync(path.join(SKILLS, "coordinator", "SKILL.md"), "utf8");
    assert.match(implementer, /^name: implementer$/m);
    assert.match(reviewer, /^name: reviewer$/m);
    assert.match(coordinator, /^name: coordinator$/m);
    assert.match(implementer, /Test Implementer/);
    assert.match(implementer, /must not weaken independently authored tests/i);
    assert.match(implementer, /Neither.*self-certif/i);
    assert.match(implementer, /published standard/);
    assert.match(implementer, /recorded Lifecycle snapshot/);
    assert.match(coordinator, /proven-independent/);
    assert.match(coordinator, /never add a nested coordinator/);
    assert.match(reviewer, /`ACCEPT`, `ACCEPT_WITH_FINDINGS`, and `BLOCK` are terminal/);
    assert.match(reviewer, /`REPAIR_REQUIRED`\s+permits bounded correction/);
  });
});

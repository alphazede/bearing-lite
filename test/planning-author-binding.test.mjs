import { boundHook, withTask } from "./task-opt-in-fixture.mjs";
/**
 * Planning authorship (F1/F5/F7 repair): specialists own their content, the
 * Planning Orchestrator controller authors final plan/design, assembly, and the
 * planning handoff in its own session, and no separate design author exists.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = boundHook(require("../hooks/orchestrator-write-lock.cjs"));
const PLAN = "docs/plans/example";
const ARTIFACTS = {
  technical_plan: `${PLAN}/example-technical-plan.md`,
  design: `${PLAN}/design.md`,
  seit: `${PLAN}/seit.json`,
  implementation: `${PLAN}/implementation.json`,
  manifest: `${PLAN}/example-dod-manifest.html`,
  handoff: `${PLAN}/handoff.md`,
};
const write = (role, file, extra = {}) => lock.evaluate({ role, paths: [file], ...extra });
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe("F1: the Planning Orchestrator authors final plan/design in its own session", () => {
  it("the controller writes the technical plan, design, assembly, and handoff", () => {
    for (const file of [ARTIFACTS.technical_plan, ARTIFACTS.design, ARTIFACTS.implementation, ARTIFACTS.manifest, ARTIFACTS.handoff]) {
      assert.equal(write("orchestrator", file).verdict, "ALLOW", `orchestrator: ${file}`);
      assert.equal(write("", file).verdict, "ALLOW", `role-less controller: ${file}`);
    }
  });

  it("a role-less subagent is never treated as the controller", () => {
    for (const file of Object.values(ARTIFACTS)) {
      const result = write("", file, { agent_id: "unassigned-child" });
      assert.equal(result.verdict, "DENY_DISPATCH", file);
      assert.doesNotMatch(String(result.reason), /Dispatch skills\/planning-and-design/);
    }
  });

  it("the controller still cannot author specialist-owned requirements or SEIT", () => {
    const seit = write("orchestrator", ARTIFACTS.seit);
    assert.equal(seit.verdict, "DENY_DISPATCH");
    assert.equal(seit.owner, "test_engineer");
    const register = write("orchestrator", "docs/coe/register.sdoc");
    assert.equal(register.verdict, "DENY_DISPATCH");
    assert.equal(register.owner, "requirements_engineer");
  });

  it("no deny path dispatches a separate Planning and Design author", () => {
    const denials = [
      write("", ARTIFACTS.design, { agent_id: "child" }),
      write("coordinator", ARTIFACTS.technical_plan),
      write("requirements_engineer", ARTIFACTS.design),
      write("planning_and_design", ARTIFACTS.design),
    ];
    for (const result of denials) {
      assert.equal(result.verdict, "DENY_DISPATCH");
      assert.doesNotMatch(`${result.reason} ${result.dispatch}`, /BEARING_ROLE=planning_and_design|skills\/planning-and-design/);
    }
  });
});

describe("specialist ownership is preserved", () => {
  it("requirements, test, and modeler authors keep only their own outputs", () => {
    assert.equal(write("requirements_engineer", "docs/coe/register.sdoc").verdict, "ALLOW");
    assert.equal(write("requirements_engineer", ARTIFACTS.design).verdict, "DENY_DISPATCH");
    assert.equal(write("test_engineer.planning", ARTIFACTS.seit).verdict, "ALLOW");
    assert.equal(write("test_engineer.planning", ARTIFACTS.design).verdict, "DENY_DISPATCH");
    assert.equal(write("systems_modeler", ARTIFACTS.design).verdict, "ALLOW");
    assert.equal(write("systems_modeler", ARTIFACTS.technical_plan).verdict, "DENY_DISPATCH");
    assert.equal(write("integration_engineer.planning", ARTIFACTS.design).verdict, "DENY_DISPATCH");
  });

  it("Coordinator keeps wave assembly but cannot author specialist content or the handoff", () => {
    for (const file of [ARTIFACTS.implementation, ARTIFACTS.manifest]) {
      assert.equal(write("coordinator", file).verdict, "ALLOW", file);
    }
    for (const file of [ARTIFACTS.technical_plan, ARTIFACTS.design, ARTIFACTS.seit, ARTIFACTS.handoff]) {
      assert.equal(write("coordinator", file).verdict, "DENY_DISPATCH", file);
    }
  });

  it("shell writes have the same ownership boundary", () => {
    assert.equal(lock.evaluate({ role: "coordinator", tool_input: { command: `cat > ${ARTIFACTS.design}` } }).verdict, "DENY_DISPATCH");
    assert.equal(lock.evaluate({ role: "implementer", tool_input: { command: `echo x > ${ARTIFACTS.handoff}` } }).verdict, "DENY_DISPATCH");
    assert.equal(lock.evaluate({ tool_input: { command: `echo x > ${ARTIFACTS.seit}` } }).verdict, "DENY_DISPATCH");
  });

  it("retired planning identities cannot exploit the unknown-role fallback", () => {
    for (const role of ["plan_integrator", "Plan Integrator", "plan_integrator.planning", "planning_and_design", "Planning and Design"]) {
      for (const file of [...Object.values(ARTIFACTS), "src/index.js"]) {
        const result = write(role, file);
        assert.equal(result.verdict, "DENY_DISPATCH", `${role}: ${file}`);
        assert.match(String(result.reason), /retired_role/);
      }
    }
  });
});

describe("F5: handoff.md is protected only at the planning path", () => {
  it("execution roles cannot write the lifecycle handoff", () => {
    for (const role of ["implementer", "light_implementer", "test_implementer", "repair_implementer", "reviewer", "test_engineer", "scribe"]) {
      assert.equal(write(role, ARTIFACTS.handoff).verdict, "DENY_DISPATCH", role);
      assert.equal(write(role, `/abs/repo/${ARTIFACTS.handoff}`).verdict, "DENY_DISPATCH", `${role} absolute`);
    }
  });

  it("unrelated product files named handoff.md stay under the slice write set", () => {
    for (const [role, file] of [
      ["implementer", "src/docs/handoff.md"],
      ["light_implementer", "packages/x/handoff.md"],
      ["implementer", "handoff.md"],
      ["test_implementer", "test/fixtures/handoff.md"],
    ]) {
      const result = write(role, file);
      assert.equal(result.verdict, "ALLOW", `${role}: ${file}`);
      assert.equal(result.reason, "role_write_allowed");
    }
    // The Orchestrator writing a product handoff.md is not a planning write either.
    assert.equal(write("orchestrator", "src/docs/handoff.md").reason, "path_not_locked");
  });

  it("a handoff beside planning artifacts outside docs/plans stays protected", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "bl-handoff-"));
    temps.push(root);
    mkdirSync(path.join(root, "planning/topic"), { recursive: true });
    writeFileSync(path.join(root, "planning/topic/implementation.json"), "{}");
    mkdirSync(path.join(root, "src"), { recursive: true });
    assert.equal(write("implementer", "planning/topic/handoff.md", { cwd: root }).verdict, "DENY_DISPATCH");
    assert.equal(write("orchestrator", "planning/topic/handoff.md", { cwd: root }).verdict, "ALLOW");
    assert.equal(write("implementer", "src/handoff.md", { cwd: root }).verdict, "ALLOW");
  });

  it("execution paths remain governed by the existing slice write set", () => {
    assert.equal(write("implementer", "docs/product/design.md").verdict, "ALLOW");
    assert.equal(write("scribe", `${PLAN}/journey.json`).verdict, "ALLOW");
  });
});

describe("F7: planning route discovery", () => {
  const schema = JSON.parse(readFileSync(path.join(ROOT, "schemas/profiles.schema.json"), "utf8"));
  const roleSets = [];
  (function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.properties && (value.properties.implementer || value.properties.reviewer)) roleSets.push(value.properties);
    for (const item of Object.values(value)) walk(item);
  })(schema);

  it("retired planning routes return a migration receipt without mutating or copying catalog data", () => {
    const { evaluateCatalogState } = require("../hooks/profiles.cjs");
    for (const key of ["plan_integrator", "planning_and_design"]) {
      const home = mkdtempSync(path.join(os.tmpdir(), "bl-profile-migration-"));
      temps.push(home);
      const dir = path.join(home, ".agents/bearing-lite");
      mkdirSync(dir, { recursive: true });
      const catalog = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/profiles-populated.example.json"), "utf8"));
      const profile = Object.keys(catalog.profiles)[0];
      catalog.profiles[profile].roles[key] = structuredClone(catalog.profiles[profile].roles.implementer);
      const bytes = JSON.stringify(catalog);
      const file = path.join(dir, "profiles.json");
      writeFileSync(file, bytes);
      const result = evaluateCatalogState({ env: { HOME: home } });
      assert.equal(result.outcome, "MIGRATION_REQUIRED", key);
      assert.equal(result.reason, `retired_role:${key}`);
      assert.equal(result.profile, profile);
      assert.match(result.migration, /preserve all other roles.*capability sections; never copy/);
      assert.equal(readFileSync(file, "utf8"), bytes, "classification must leave every route and capability untouched");
      delete catalog.profiles[profile].roles[key];
      writeFileSync(file, JSON.stringify(catalog));
      assert.equal(evaluateCatalogState({ env: { HOME: home } }).outcome, "READY");
    }
  });

  it("the removed skills and routes are absent", () => {
    assert.equal(existsSync(path.join(ROOT, "skills/plan-integrator")), false);
    assert.ok(roleSets.length > 0, "profile role properties must be discoverable");
    for (const roles of roleSets) {
      assert.equal(Object.hasOwn(roles, "plan_integrator"), false);
      assert.equal(Object.hasOwn(roles, "planning_and_design"), false, "no dead Planning and Design route");
      assert.equal(Object.hasOwn(roles, "orchestrator"), false, "the Orchestrator is observed, not selected");
    }
  });
});

/**
 * #195 Planning artifacts have bound authors. The planning Orchestrator
 * dispatches the Plan Integrator once; the Plan Integrator dispatches the
 * planning sessions; Planning and Design authors on the frozen
 * plan_integrator route; the Coordinator never authors planning artifacts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const lock = require("../hooks/orchestrator-write-lock.cjs");

const PLAN = "docs/plans/2026-10-16-example";
const ARTIFACTS = {
  technical_plan: `${PLAN}/example-technical-plan.md`,
  design: `${PLAN}/design.md`,
  seit: `${PLAN}/seit.json`,
  implementation: `${PLAN}/implementation.json`,
  manifest: `${PLAN}/example-dod-manifest.html`,
};
const write = (role, file) => lock.evaluate({ role, agent_id: "a1", paths: [file] });

describe("#195 bound planning authors (write lock)", () => {
  it("Coordinator cannot author the technical plan, design, or SEIT", () => {
    for (const file of [ARTIFACTS.technical_plan, ARTIFACTS.design, ARTIFACTS.seit]) {
      const result = write("coordinator", file);
      assert.equal(result.verdict, "DENY_DISPATCH", file);
      assert.match(result.reason, /^coordinator cannot write/);
      assert.match(result.dispatch, /BEARING_ROLE=plan_integrator/);
    }
  });

  it("Coordinator keeps its once-per-wave implementation.json and Manifest updates", () => {
    assert.equal(write("coordinator", ARTIFACTS.implementation).verdict, "ALLOW");
    assert.equal(write("coordinator", ARTIFACTS.manifest).verdict, "ALLOW");
  });

  it("a shell write by the Coordinator is refused too", () => {
    const result = lock.evaluate({
      role: "coordinator",
      tool_input: { command: `cat > ${ARTIFACTS.design} <<'EOF'\nx\nEOF` },
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
  });

  it("Planning and Design authors every planning artifact", () => {
    for (const file of Object.values(ARTIFACTS)) {
      assert.equal(write("planning_and_design", file).verdict, "ALLOW", file);
    }
  });

  it("Plan Integrator generates but never authors sections", () => {
    assert.equal(write("plan_integrator", ARTIFACTS.implementation).verdict, "ALLOW");
    assert.equal(write("plan_integrator", ARTIFACTS.manifest).verdict, "ALLOW");
    for (const file of [ARTIFACTS.technical_plan, ARTIFACTS.design, ARTIFACTS.seit]) {
      assert.equal(write("plan_integrator", file).verdict, "DENY_DISPATCH", file);
    }
  });

  it("specialists write only their own outputs", () => {
    assert.equal(write("test_engineer.planning", ARTIFACTS.seit).verdict, "ALLOW");
    assert.equal(write("test_engineer.planning", ARTIFACTS.design).verdict, "DENY_DISPATCH");
    assert.equal(write("systems_modeler", ARTIFACTS.design).verdict, "ALLOW");
    assert.equal(write("systems_modeler", ARTIFACTS.technical_plan).verdict, "DENY_DISPATCH");
    assert.equal(write("requirements_engineer", ARTIFACTS.technical_plan).verdict, "DENY_DISPATCH");
    assert.equal(write("integration_engineer.planning", ARTIFACTS.implementation).verdict, "DENY_DISPATCH");
    assert.equal(write("scribe", ARTIFACTS.design).verdict, "DENY_DISPATCH");
  });

  it("the Orchestrator stays refused, and non-planning paths stay open", () => {
    assert.equal(lock.evaluate({ role: "orchestrator", paths: [ARTIFACTS.design] }).verdict, "DENY_DISPATCH");
    assert.equal(write("coordinator", "src/app.js").verdict, "ALLOW");
    assert.equal(write("scribe", `${PLAN}/journey.json`).verdict, "ALLOW");
  });

  it("execution roles remain under the slice write-set check", () => {
    assert.equal(write("implementer", "docs/product/design.md").verdict, "ALLOW");
  });
});

describe("#195 planning dispatch (skills)", () => {
  const router = read("skills/bearing-lite/SKILL.md");
  const integrator = read("skills/plan-integrator/SKILL.md");
  const planning = read("skills/planning-and-design/SKILL.md");
  const coordinator = read("skills/coordinator/SKILL.md");
  const modeler = read("skills/systems-modeler/SKILL.md");
  const requirements = read("skills/requirements-engineer/SKILL.md");

  it("the planning Orchestrator dispatches the Plan Integrator once and never relays", () => {
    assert.match(router, /Dispatch the Plan Integrator once settled \(`BEARING_ROLE=plan_integrator`\)/);
    assert.match(router, /never relays between them/);
    assert.match(integrator, /dispatches it\s+once/);
  });

  it("the Plan Integrator dispatches planning sessions in one stated input order (#205, #155)", () => {
    const order = [
      "Systems Modeler contextual pass",
      "Planning and Design (`BEARING_ROLE=planning_and_design`",
      "hooks/register-precheck.cjs`, then Requirements Engineer",
      "Integration Engineer planning session",
      "Systems Modeler model pass",
      "Planning Test Engineer finalizes `seit.json`",
    ].map((step) => integrator.indexOf(step));
    assert.ok(order.every((i) => i >= 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    // The order is of inputs, never a verdict gate between sessions.
    assert.match(integrator, /never verdicts: none waits on a Requirements Engineer pass/);
    assert.doesNotMatch(integrator, /after the Requirements Engineer passes/);
  });

  it("the Plan Integrator never authors sections or resolves conflicts", () => {
    assert.match(integrator, /never write section\s+content/);
    assert.match(integrator, /Conflicts return `NEEDS_OWNER_DECISION`/);
  });

  it("Planning and Design is the bound author on the frozen plan_integrator route", () => {
    assert.match(planning, /dispatched only by the Plan Integrator on the frozen `plan_integrator` route/);
    assert.match(planning, /never run by the Orchestrator or Coordinator/);
    assert.match(integrator, /frozen\s+`plan_integrator` route, never this session/);
  });

  it("a Coordinator under a planning hold dispatches nothing and authors nothing", () => {
    assert.match(coordinator, /planning \(Plan Integrator\)/);
    assert.match(coordinator, /a hold assigning planning to the Coordinator is not honored/);
    assert.match(coordinator, /never writes planning artifacts/);
  });

  it("the Systems Modeler order is stated once", () => {
    assert.match(modeler, /contextual pass \(when selected or required\) before Planning\s+and Design drafts the register/);
    assert.match(modeler, /model pass over the drafts and the\s+Integration Engineer boundary contract/);
    assert.match(modeler, /Neither pass\s+waits on a Requirements Engineer verdict/);
    assert.doesNotMatch(modeler, /before or alongside Planning and Design pass 1/);
  });

  it("Requirements Engineer fixes are applied by the bound author", () => {
    assert.match(requirements, /the Planning and Design session applies it/);
  });
});

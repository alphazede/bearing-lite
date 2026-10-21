/**
 * CMD-STAGE-ORDER-01 / SEIT-STAGE-ORDER-01 (issue #159, F4 repair)
 * Planning data dependencies are acyclic: the Requirements Engineer authors
 * from confirmed Alignment/Scope context without placements; a selected
 * Systems Modeler then supplies a placement receipt; final Planning and Design
 * allocates against that receipt and records a typed gap (never silent
 * allocation) when a selected or required Modeler is unavailable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const assembly = read("skills/bearing-lite/references/planning-assembly.md");
const taskState = read("skills/bearing-lite/references/task-state.md");
const routing = read("skills/bearing-lite/references/role-routing.mmd");
const modeler = read("skills/systems-modeler/SKILL.md");
const requirements = read("skills/requirements-engineer/SKILL.md");
const pdSkill = read("skills/planning-and-design/SKILL.md");
const allocationInputs = read("skills/planning-and-design/references/allocation-inputs.md");

describe("CMD-STAGE-ORDER-01 acyclic planning dependencies (SEIT-STAGE-ORDER-01)", () => {
  it("assembly orders Requirements Engineer, then Systems Modeler, then final Planning and Design", () => {
    const re = assembly.indexOf("**Requirements Engineer");
    const sm = assembly.indexOf("**Systems Modeler");
    const pd = assembly.indexOf("final Planning and Design");
    assert.ok(re >= 0 && sm > re && pd > sm, "RE -> Modeler -> final P&D");
  });

  it("the Requirements Engineer does not wait on later placements, SEIT, or final design", () => {
    assert.doesNotMatch(requirements, /Consume selected placement evidence before allocating/);
    assert.match(requirements, /Do not wait for later Modeler placements, SEIT, or final design/);
    assert.match(requirements, /--stage requirements/);
  });

  it("task-state text and role-routing diagram agree: no Modeler pass before the register draft", () => {
    assert.doesNotMatch(taskState, /contextual pass[\s\S]{0,400}before the first register draft/);
    assert.match(taskState, /placement receipt/);
    assert.doesNotMatch(routing, /Systems Modeler contextual pass/);
    assert.ok(routing.indexOf("Requirements Engineer") < routing.indexOf("Systems Modeler"));
    assert.ok(routing.indexOf("Systems Modeler") < routing.indexOf("final Planning and Design"));
  });

  it("systems modeler covers flow, placements, and constraints from the requirements", () => {
    assert.match(modeler, /current flow/);
    assert.match(modeler, /candidate placements with `file:line`/);
    assert.match(modeler, /constraints/);
    assert.match(modeler, /placement receipt/);
  });

  it("final allocation consumes the placement receipt, cites it, and gaps when unavailable", () => {
    assert.match(allocationInputs, /placement receipt/);
    assert.match(allocationInputs, /input to allocation/);
    assert.match(allocationInputs, /cites[\s\S]{0,40}receipt/);
    assert.match(allocationInputs, /typed capability gap/);
    assert.match(allocationInputs, /never allocate silently/);
    assert.match(allocationInputs, /OWNER_DECISION_REQUIRED/);
    assert.match(pdSkill, /references\/allocation-inputs\.md/);
    assert.match(pdSkill, /placement receipt/);
  });
});

/**
 * CMD-STAGE-ORDER-01 / SEIT-STAGE-ORDER-01 (issue #159)
 * A Systems Modeler contextual pass runs before the first register draft
 * whenever that role is selected or required; P&D allocates against its
 * placement receipt and records a typed gap when it is unavailable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
const taskState = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/task-state.md"),
  "utf8"
);
const routing = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/role-routing.mmd"),
  "utf8"
);
const modeler = readFileSync(path.join(ROOT, "skills/systems-modeler/SKILL.md"), "utf8");
const pdSkill = readFileSync(
  path.join(ROOT, "skills/planning-and-design/SKILL.md"),
  "utf8"
);
const allocationInputs = readFileSync(
  path.join(ROOT, "skills/planning-and-design/references/allocation-inputs.md"),
  "utf8"
);

describe("CMD-STAGE-ORDER-01 systems-modeler contextual pass (SEIT-STAGE-ORDER-01)", () => {
  it("orchestrator schedules the contextual pass before the first register draft when selected or required", () => {
    assert.match(router, /Systems Modeler contextual pass/);
    assert.match(router, /selected or required/);
    assert.match(
      router,
      /Systems Modeler contextual pass[\s\S]{0,400}before the first register draft/
    );
  });

  it("orchestrator records a typed gap instead of allocating silently when unavailable", () => {
    assert.match(router, /Systems Modeler[\s\S]{0,400}typed capability gap/);
    assert.match(router, /never silent allocation|not silently allocat/i);
  });

  it("task-state text and role-routing diagram place the contextual pass before Planning and Design", () => {
    assert.match(taskState, /Systems Modeler contextual pass/);
    assert.match(
      taskState,
      /Systems Modeler contextual pass[\s\S]{0,400}before the first register draft/
    );
    assert.match(routing, /Systems Modeler contextual/);
    assert.match(routing, /placement receipt/);
    assert.ok(
      routing.indexOf("Systems Modeler") < routing.indexOf("Fresh Planning and Design"),
      "contextual pass must precede Planning and Design in the diagram"
    );
  });

  it("systems modeler covers flow, placements, and constraints, and finalizes mappings only after the Requirements Engineer passes", () => {
    assert.match(modeler, /contextual pass/);
    assert.match(modeler, /current flow/);
    assert.match(modeler, /candidate placements with `file:line`/);
    assert.match(modeler, /constraints/);
    assert.match(
      modeler,
      /Do not finalize requirement\s+relationship mappings until the Requirements Engineer passes/
    );
  });

  it("planning-and-design allocation consumes the placement receipt, cites it in pass 1, and gaps when unavailable", () => {
    assert.match(allocationInputs, /placement receipt/);
    assert.match(allocationInputs, /input to allocation/);
    assert.match(allocationInputs, /pass-1 return cites the placement receipt/i);
    assert.match(allocationInputs, /typed gap/);
    assert.match(allocationInputs, /NEEDS_OWNER_DECISION/);
    assert.match(allocationInputs, /Requirements Engineer/);
  });

  it("planning-and-design skill reaches allocation-inputs before register allocation", () => {
    assert.match(pdSkill, /references\/allocation-inputs\.md/);
    assert.match(pdSkill, /before register allocation/);
  });
});

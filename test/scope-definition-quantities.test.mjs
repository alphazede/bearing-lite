/**
 * Issue #161: the combined Architectural Alignment and Scope final decision
 * batch must define every numeric quantity its decisions cite and must type
 * every conditional decision, or the stage cannot return WORKSPACE_READY
 * (shared understanding confirmed) and stays OWNER_DECISION_REQUIRED.
 *
 * validateDecisionBatch is a test-local reference model of that rule. It is
 * not shipped consumer proof. The shipped SKILL.md / references assertions
 * below are the instruction proof.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE_SKILL = path.join(ROOT, "skills/architectural-alignment/SKILL.md");
const BATCH_REF = path.join(
  ROOT,
  "skills/architectural-alignment/references/decision-batch.md"
);
const LEGACY_SCOPE_SKILL = path.join(ROOT, "skills/scope-definition/SKILL.md");
const LEGACY_BATCH_REF = path.join(ROOT, "skills/scope-definition/references/decision-batch.md");
const GRAMMAR = path.join(
  ROOT,
  "skills/planning-and-design/references/artifact-grammar.md"
);

const ENFORCED_RULE = "enforced_rule";
const EXPECTED_OUTCOME = "expected_outcome";

/**
 * Test-local model of the final-batch rule: every quantity a decision cites
 * must have a table row; every conditional decision must carry a type.
 * @param {{ decisions: Array<{ id: string, quantities?: string[], conditional?: { kind?: string } | null }>, quantityDefinitions: Array<{ name: string }> }} batch
 */
export function validateDecisionBatch(batch) {
  const defined = new Set(batch.quantityDefinitions.map((row) => row.name));
  const undefinedQuantities = [];
  const untypedConditionals = [];
  for (const decision of batch.decisions) {
    for (const name of decision.quantities ?? []) {
      if (!defined.has(name) && !undefinedQuantities.includes(name)) {
        undefinedQuantities.push(name);
      }
    }
    if (
      decision.conditional &&
      ![ENFORCED_RULE, EXPECTED_OUTCOME].includes(decision.conditional.kind)
    ) {
      untypedConditionals.push(decision.id);
    }
  }
  return {
    ok: undefinedQuantities.length === 0 && untypedConditionals.length === 0,
    undefinedQuantities,
    untypedConditionals,
  };
}

const completeBatch = () => ({
  decisions: [
    { id: "DEC-1", quantities: ["tier_probability"], conditional: null },
    {
      id: "DEC-2",
      quantities: [],
      conditional: { kind: EXPECTED_OUTCOME },
    },
    {
      id: "DEC-3",
      quantities: ["tier_probability"],
      conditional: { kind: ENFORCED_RULE },
    },
  ],
  quantityDefinitions: [{ name: "tier_probability" }],
});

const undefinedQuantityBatch = () => ({
  decisions: [{ id: "DEC-1", quantities: ["floor_probability"], conditional: null }],
  quantityDefinitions: [{ name: "tier_probability" }],
});

describe("scope-definition quantity table and conditional typing", () => {
  it("fails a batch that cites an undefined quantity and names it", () => {
    const verdict = validateDecisionBatch(undefinedQuantityBatch());
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.undefinedQuantities, ["floor_probability"]);
  });

  it("passes a complete batch with every quantity defined and every conditional typed", () => {
    const verdict = validateDecisionBatch(completeBatch());
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.undefinedQuantities, []);
    assert.deepEqual(verdict.untypedConditionals, []);
  });

  it("fails a conditional decision without an enforced_rule or expected_outcome type", () => {
    const batch = completeBatch();
    batch.decisions.push({ id: "DEC-4", quantities: [], conditional: { kind: "rule" } });
    const verdict = validateDecisionBatch(batch);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.untypedConditionals, ["DEC-4"]);
  });

  it("combined Alignment/Scope requires the table and typing in its final batch", () => {
    const scope = readFileSync(SCOPE_SKILL, "utf8");
    const ref = readFileSync(BATCH_REF, "utf8");
    assert.match(scope, /references\/decision-batch\.md/);
    assert.match(scope, /quantity-definitions table/);
    assert.match(scope, /enforced_rule/);
    assert.match(scope, /expected_outcome/);
    assert.match(scope, /blocks `WORKSPACE_READY`/);
    assert.match(scope, /class C/);
    assert.match(ref, /cannot return `WORKSPACE_READY`/);
    assert.match(ref, /`OWNER_DECISION_REQUIRED`/);
    assert.match(ref, /class C/);
    // The legacy name forwards to the same contract; it adds no stage.
    assert.match(readFileSync(LEGACY_SCOPE_SKILL, "utf8"), /\.\.\/architectural-alignment\/SKILL\.md/);
    assert.match(readFileSync(LEGACY_BATCH_REF, "utf8"), /architectural-alignment\/references\/decision-batch\.md/);
    assert.match(ref, /name/);
    assert.match(ref, /formula/);
    assert.match(ref, /denominator/);
    assert.match(ref, /ties|pushes|voids/);
    assert.match(ref, /units/);
    assert.match(ref, /source field or contract/);
  });

  it("F11: every outcome the decision batch names is in the combined stage's return set", () => {
    const scope = readFileSync(SCOPE_SKILL, "utf8");
    const ref = readFileSync(BATCH_REF, "utf8");
    const returns = scope.slice(scope.indexOf("\nReturn "));
    const named = [...ref.matchAll(/`([A-Z][A-Z_]{3,})`/g)].map((m) => m[1]);
    assert.ok(named.length >= 2, "batch must name its outcomes");
    for (const outcome of named) assert.ok(returns.includes(`\`${outcome}\``), `${outcome} is not a supported return`);
    assert.doesNotMatch(ref, /SHARED_UNDERSTANDING_CONFIRMED/);
  });

  it("Requirements Engineer precheck context uses the same table before any plan exists (F4)", () => {
    const template = readFileSync(path.join(ROOT, "skills/architectural-alignment/templates/workspace.md"), "utf8");
    assert.match(template, /### Quantity definitions/);
    assert.match(template, /`DEC-<id>`/);
    const precheck = readFileSync(path.join(ROOT, "skills/requirements-engineer/references/precheck.md"), "utf8");
    assert.match(precheck, /--stage requirements/);
    assert.match(precheck, /### Quantity definitions/);
    assert.doesNotMatch(precheck, /Copy the Scope\s+Definition quantity-definitions table/);
  });

  it("Planning and Design copies the table into the glossary instead of redefining it", () => {
    const planning = readFileSync(
      path.join(ROOT, "skills/planning-and-design/SKILL.md"),
      "utf8"
    );
    const grammar = readFileSync(GRAMMAR, "utf8");
    assert.match(planning, /glossary/);
    assert.match(grammar, /quantity-definitions table/);
    assert.match(grammar, /glossary/);
    assert.match(grammar, /instead of redefining|verbatim/);
  });
});

/** S1 / SEIT-143.01–07: red tests for the deterministic assurance gate chain. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { ASSURANCE_BUDGET_POLICY } = require(path.join(root, "hooks/policy.cjs"));
const assurance = require(path.join(root, "hooks/assurance-budget.cjs"));
const { evaluateVerification } = require(path.join(root, "hooks/verification.cjs"));
const read = (file) => readFileSync(path.join(root, file), "utf8");
const ORDER = ["build", "types_lint", "red_then_green", "mutation", "changed_line_coverage", "reverify", "reviewer"];

// The evaluator is deliberately absent at baseline. Each case fails at this
// assertion instead of crashing the file, and will exercise the real export in S5.
function evaluate(gate_declarations, results = {}) {
  assert.equal(typeof assurance.evaluateGateChain, "function", "gate-chain evaluator export is missing");
  return assurance.evaluateGateChain({ gate_declarations, results });
}

const skipped = { status: "NOT_APPLICABLE", reason: "fixture gate is outside this case" };
const declarations = (overrides = {}) => Object.fromEntries(
  ORDER.map((gate) => [gate, overrides[gate] ?? skipped]),
);
const declared = { status: "DECLARED", tool: "fixture-tool", threshold: 80 };
const passing = { tool_available: true, outcome: "PASS", score: 80 };

test("AC-143.01 / SEIT-143.01 fixed seven-gate policy order", () => {
  const block = read("skills/bearing-lite/references/assurance-policy.md").match(/```json\n([\s\S]*?)\n```/);
  assert.ok(block, "assurance policy JSON block is missing");
  assert.deepStrictEqual(ASSURANCE_BUDGET_POLICY.gate_order, ORDER);
  assert.deepStrictEqual(assurance.POLICY.gate_order, ORDER);
  assert.deepStrictEqual(JSON.parse(block[1]).gate_order, ORDER);
});

test("AC-143.02 / SEIT-143.02 claim types and typed-gap rules in both references", () => {
  for (const file of ["skills/test-engineer/SKILL.md", "skills/bearing-lite/references/verification.md"]) {
    const text = read(file);
    for (const term of ["mutation", "changed-line coverage", "red-then-green", "missing tool", "not_run"]) {
      assert.ok(text.includes(term), `${file}: missing ${term} claim/gap rule`);
    }
    assert.match(text, /typed[- ]gap/i, `${file}: missing typed-gap rule`);
  }
});

test("AC-143.03 / SEIT-143.03 declared missing tool and not_run are typed gaps", () => {
  const gates = declarations({ mutation: declared });
  for (const observed of [{ tool_available: false }, { tool_available: true, outcome: "not_run" }]) {
    const got = evaluate(gates, { mutation: observed });
    assert.equal(got.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(got.failed_gate, "mutation");
  }
});

test("AC-143.04 / SEIT-143.04 independent boundary rerun and diagnostic-only prose", () => {
  for (const file of ["skills/test-engineer/SKILL.md", "skills/bearing-lite/references/verification.md"]) {
    const text = read(file);
    assert.ok(/Assurance Test Engineer[\s\S]{0,180}independently reruns? the gate[- ]chain[\s\S]{0,100}boundary/i.test(text), `${file}: independent gate-chain boundary rerun rule missing`);
    assert.ok(/author gate[- ]chain receipts?[\s\S]{0,100}diagnostic/i.test(text), `${file}: author gate-chain diagnostic-only rule missing`);
  }
});

test("AC-143.04 / SEIT-143.04 diagnostic receipt cannot satisfy assurance gate (regression guard)", () => {
  const candidate = { candidate_ref: "candidate", candidate_revision: "a".repeat(40) };
  const author = { role: "implementer", identity: "author", session: "author-session" };
  const request = {
    schema_version: "1", kind: "request", ...candidate, claim_id: "gate-chain", claim_type: "gate_chain",
    backend: "node:test", stage: "implementation", authority: "diagnostic", expected_result: "VERIFIED",
    command_configuration: { command: "node --test" }, selected: true, required: true,
  };
  const receipt = {
    schema_version: "1", kind: "receipt", ...candidate, claim_id: "gate-chain", backend: "node:test",
    backend_version: "fixture", command_configuration: request.command_configuration,
    evidence_digest: "b".repeat(64), status: "VERIFIED", authority: "diagnostic",
    stage: "implementation", produced_by: author,
  };
  const got = evaluateVerification({
    request, receipt, candidate, author, gate: "assurance",
    backend: { name: "node:test", enabled: true, available: true },
  });
  assert.equal(got.outcome, "REJECT");
  assert.equal(got.reason, "diagnostic_cannot_satisfy_assurance_gate");
  assert.equal(got.gate_eligible, false);
});

test("AC-143.05 missing-tool / SEIT-143.05 declared gate yields a typed gap", () => {
  const got = evaluate(declarations({ mutation: declared }), { mutation: { tool_available: false } });
  assert.equal(got.outcome, "NEEDS_MORE_EVIDENCE");
  assert.equal(got.failed_gate, "mutation");
});

test("AC-143.05 threshold / SEIT-143.05 score below the declared threshold fails", () => {
  const got = evaluate(declarations({ mutation: declared }), {
    mutation: { tool_available: true, outcome: "PASS", score: 79 },
  });
  assert.equal(got.outcome, "FAIL");
  assert.equal(got.failed_gate, "mutation");
});

test("AC-143.05 fail-fast / SEIT-143.05 later gates cannot pass after first failure", () => {
  const got = evaluate(declarations({ mutation: declared, changed_line_coverage: declared }), {
    mutation: { tool_available: true, outcome: "FAIL", score: 20 },
    changed_line_coverage: passing,
  });
  assert.equal(got.outcome, "FAIL");
  assert.equal(got.failed_gate, "mutation");
  assert.ok(Array.isArray(got.gates), "ordered gate results are missing");
  assert.deepStrictEqual(got.gates.map(({ gate }) => gate), ORDER.slice(0, ORDER.indexOf("mutation") + 1));
  assert.equal(got.gates.some(({ gate, outcome }) => gate === "changed_line_coverage" && outcome === "PASS"), false);
});

test("AC-143.06 / SEIT-143.06 undeclared or reasonless mutation fails closed", () => {
  for (const mutation of [undefined, { status: "NOT_APPLICABLE", reason: "" }]) {
    const gates = declarations();
    if (mutation === undefined) delete gates.mutation;
    else gates.mutation = mutation;
    const got = evaluate(gates);
    assert.equal(got.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(got.failed_gate, "mutation");
  }
});

test("AC-143.06 / SEIT-143.06 reasoned non-gate and declared hard gate", () => {
  const nonGate = evaluate(declarations());
  assert.equal(nonGate.outcome, "PASS");
  const hardGate = evaluate(declarations({ mutation: declared }), { mutation: passing });
  assert.equal(hardGate.outcome, "PASS");
  assert.ok(hardGate.gates.some(({ gate, outcome }) => gate === "mutation" && outcome === "PASS"));
});

test("AC-143.07 / SEIT-143.07 red-then-green needs both runs with matching test ids", () => {
  const baseline = { revision: "baseline", outcome: "FAIL", test_ids: ["T-1"] };
  const candidate = { revision: "candidate", outcome: "PASS", test_ids: ["T-1"] };
  const gates = declarations({ red_then_green: { status: "DECLARED", tool: "node:test", threshold: "same test ids" } });
  const run = (receipt) => evaluate(gates, {
    red_then_green: { tool_available: true, outcome: "PASS", receipt },
  });
  for (const receipt of [
    { candidate },
    { baseline },
    { baseline, candidate: { ...candidate, test_ids: ["T-2"] } },
  ]) {
    const got = run(receipt);
    assert.equal(got.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(got.failed_gate, "red_then_green");
  }
  assert.equal(run({ baseline, candidate }).outcome, "PASS");
});

test("AC-143.07 / SEIT-143.07 receipt prose binds baseline failure to candidate pass", () => {
  for (const file of ["skills/test-engineer/SKILL.md", "skills/implementer/SKILL.md"]) {
    const text = read(file);
    assert.ok(/red[- ]then[- ]green receipt[\s\S]{0,180}baseline failing run[\s\S]{0,100}candidate passing run/i.test(text), `${file}: baseline-failure/candidate-pass receipt rule missing`);
  }
});

/** S2: SEIT-144.01–144.04 and SEIT-145.01–145.02. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewer = readFileSync(path.join(root, "skills/reviewer/SKILL.md"), "utf8");
const policyText = readFileSync(path.join(root, "skills/bearing-lite/references/assurance-policy.md"), "utf8");
const policyBlock = JSON.parse(policyText.match(/```json\n([\s\S]*?)\n```/)[1]);
const budget = createRequire(import.meta.url)(path.join(root, "hooks/assurance-budget.cjs"));

test("AC-144.01 / SEIT-144.01: actionable findings require location and reproducer; others cost no repair", () => {
  assert.match(reviewer, /finding[s]?[^.]*counts? toward[^.]*`?REPAIR_REQUIRED`?[^.]*`?BLOCK`?[^.]*only with `?file:line`? plus a failing test or reproducer/i);
  assert.match(reviewer, /(?:otherwise|without[^.]*reproducer)[^.]*advisory[^.]*no repair budget/i);
});

test("AC-144.02 / SEIT-144.02: advisory-only findings cannot block or require repair", () => {
  assert.match(reviewer, /(?:verdict|findings)[^.]*only (?:on |of )?advisory[^.]*(?:cannot|must not|never)[^.]*`?REPAIR_REQUIRED`?[^.]*`?BLOCK`?/i);
});

test("AC-144.03 / SEIT-144.03: Reviewer uses gate evidence and limits its scope", () => {
  assert.match(reviewer, /(?:scope|review)[^.]*limited to[^.]*requirement conformance[^.]*design[^.]*security reasoning[^.]*plan drift/i);
  assert.match(reviewer, /consum(?:e|es) the gate-chain receipt/i);
  assert.match(reviewer, /(?:do(?:es)? not|never|must not) re-litigate passed gates/i);
  assert.match(reviewer, /Assurance Test Engineer[^.]*(?:does not|must not|never) re-review code/i);
  assert.match(reviewer, /no (?:concrete |external semantic )?classifier is named or required/i);
});

test("AC-144.04", () => {
  assert.match(reviewer, /finding[s]?[^.]*only with `?file:line`? plus a failing test or reproducer/i);
  assert.match(reviewer, /(?:otherwise|without[^.]*reproducer)[^.]*advisory/i);

  // Frozen receipt uses the existing fields; no Reviewer classifier is introduced.
  const receipt = {
    candidate_ref: "candidate",
    candidate_revision: "revision",
    candidate_digest: "digest",
    verdict: "ACCEPT_WITH_FINDINGS",
    finding_ids: ["F1"],
    severity: { F1: "P2" },
    locations: { F1: "src/a.js:4" },
    reachability: { F1: "reachable" },
    reproducer: { F1: "" },
    seit_refs: { F1: "SEIT-144.04" },
    repair_target: "src/a.js",
    write_set: ["src/a.js"],
  };
  const finding = receipt.finding_ids[0];
  const classify = () =>
    /:\d+$/.test(receipt.locations[finding]) && Boolean(receipt.reproducer[finding])
      ? "actionable"
      : "advisory";
  assert.equal(classify(), "advisory", "missing reproducer downgrades the finding");
  receipt.reproducer[finding] = "node --test test/a.test.mjs";
  receipt.locations[finding] = "";
  assert.equal(classify(), "advisory", "missing file:line downgrades the finding");
});

function phaseFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "reviewer-evidence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const declaration_path = path.join(dir, "declaration.json");
  const task_record_path = path.join(dir, "task-record.json");
  writeFileSync(declaration_path, JSON.stringify({
    journey_settings: {
      lifecycle_id: "L1",
      assurance_cadence: { reviewer: "phase", test_engineer: { assurance: "lifecycle" } },
    },
    phases: [{ phaseId: "P1" }],
  }));
  writeFileSync(task_record_path, JSON.stringify({ journey: "L1", units: [] }));
  return {
    journey: "L1",
    unit_kind: "phase",
    request_scope: "phase",
    assurance_unit: "P1",
    cadence: "phase",
    role: "reviewer",
    declaration_path,
    task_record_path,
  };
}

test("AC-145.01 / SEIT-145.01: phase Reviewer consumes gate-chain receipt without lifecycle TE receipt", (t) => {
  const request = phaseFixture(t);
  const result = budget.evaluateAssuranceBudget({
    ...request,
    receipts: [{ kind: "gate_chain", unit_kind: "phase", unit_id: "P1", verdict: "PASS" }],
  });
  assert.equal(result.outcome, "PASS");
  const wrongUnit = budget.evaluateAssuranceBudget({
    ...request,
    receipts: [{ kind: "gate_chain", unit_kind: "phase", unit_id: "P2", verdict: "PASS" }],
  });
  assert.equal(wrongUnit.outcome, "NEEDS_MORE_EVIDENCE");
  assert.ok(wrongUnit.reason);
});

test("AC-145.01 / SEIT-145.01: phase Reviewer with neither receipt returns a typed gap", (t) => {
  const result = budget.evaluateAssuranceBudget({ ...phaseFixture(t), receipts: [] });
  assert.equal(result.outcome, "NEEDS_MORE_EVIDENCE");
  assert.ok(result.reason);
});

test("AC-145.02 / SEIT-145.02: policy block and Reviewer skill state the mixed-cadence rule", () => {
  const policyRules = Object.values(policyBlock).filter((value) => typeof value === "string").join(" ");
  for (const text of [policyRules, reviewer]) {
    assert.match(text, /consum(?:e|es) the most recent gate-chain receipt for (?:the|that) unit/i);
    assert.match(text, /(?:no|without)[^.]*\b(?:TE|Test Engineer) receipt/i);
  }
});

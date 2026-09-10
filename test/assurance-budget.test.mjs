/**
 * CMD-LITE-CADENCE-NODE-TEST / PROC-CADENCE-UNIT-BUDGET
 * SEIT-EMV-033, SEIT-EMV-037, SEIT-EMV-015, SEIT-EMV-041, SEIT-EMV-012.
 *
 * The per-declared-phase-or-wave assurance budget (S70 test-first for S71).
 *
 * Budget identity is `journey + unit_kind + unit_id`, where the unit id is
 * resolved from the FROZEN DECLARATION (waves[].id, else phases[].phaseId,
 * else the `direct` sentinel). Candidate revision, lease generation, assigned
 * role, session, model, harness, and slice id are never key components.
 *
 * PROC-CADENCE-UNIT-BUDGET: every case except the T-LITE-01R document mirror
 * drives the real shared path — `hooks/transition-order.cjs` `evaluate()` with
 * `action_kind: "assurance_transition"` delegating to `hooks/assurance-budget.cjs`,
 * reading a durable declaration and a durable visible task record written into a
 * temp directory by the case itself. A pure evaluator fed caller-asserted
 * counters is a mirror only, never the sole proof.
 *
 * Every case below is expected RED until S71 ships
 * `hooks/assurance-budget.cjs`, `skills/bearing-lite/references/assurance-policy.md`,
 * and the `assurance_transition` action_kind in `hooks/transition-order.cjs`.
 * No new hook class and no new host event is introduced: `assurance-budget.cjs`
 * is a second pure evaluator behind the existing `transition` class, exactly as
 * `planning-review.cjs` already is.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));

/** Loaded per case so a missing product file reds only its own case. */
const budgetHook = () => require(path.join(ROOT, "hooks/assurance-budget.cjs"));

/** Frozen declarations. Ids only; names and titles are never identity. */
const WAVE_DECLARATION = { waves: [{ id: "W3", name: "third" }, { id: "W4", name: "fourth" }] };
const PHASE_DECLARATION = { phases: [{ phaseId: "P1", title: "only phase" }] };
const NO_UNIT_DECLARATION = { slices: [{ id: "S1" }] };

/** @type {string[]} */
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Durable fixture: a frozen declaration plus the visible task record that
 * carries the spent budget. Both live on disk, not in the request.
 */
function fixture(declaration, units) {
  const dir = mkdtempSync(path.join(tmpdir(), "lite-assurance-"));
  tempDirs.push(dir);
  const declaration_path = path.join(dir, "declaration.json");
  const task_record_path = path.join(dir, "task-record.json");
  writeFileSync(declaration_path, JSON.stringify(declaration, null, 2));
  writeFileSync(task_record_path, JSON.stringify({ journey: "J", units }, null, 2));
  return { dir, declaration_path, task_record_path };
}

const request = (fx, extra = {}) => ({
  journey: "J",
  unit_kind: "wave",
  assurance_unit: "W3",
  request_scope: "wave",
  declaration_path: fx.declaration_path,
  task_record_path: fx.task_record_path,
  ...extra,
});

/** The real shared path: transition adapter delegating to the budget evaluator. */
const viaTransition = (assurance) =>
  transition.evaluate({ action_kind: "assurance_transition", assurance });

const spentW3 = [
  { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 0 },
];

describe("CMD-LITE-CADENCE-NODE-TEST per-declared-unit assurance budget", () => {
  it("T-UNIT-NEXT-LITE: the next distinct declared wave carries its own budget", () => {
    const fx = fixture(WAVE_DECLARATION, [
      {
        unit_kind: "wave",
        assurance_unit: "W3",
        assurance_rounds: 1,
        assurance_repairs: 1,
        deterministic_gate: "PASS",
      },
    ]);
    const before = readFileSync(fx.task_record_path, "utf8");

    const next = viaTransition(request(fx, { assurance_unit: "W4" }));
    assert.equal(next.hook_class, "transition");
    assert.equal(next.outcome, "ADVISE");
    assert.match(String(next.reason), /assurance_budget:PASS/);
    assert.deepEqual(budgetHook().evaluateAssuranceBudget(request(fx, { assurance_unit: "W4" })), {
      outcome: "PASS",
      reason: "assurance_round_available",
    });

    // The closed W3 unit is untouched and stays closed.
    assert.equal(readFileSync(fx.task_record_path, "utf8"), before);
    assert.equal(viaTransition(request(fx)).outcome, "BLOCK");
  });

  it("T-UNIT-SAME-LITE: the same declared wave refuses a second round through every churn", () => {
    const fx = fixture(WAVE_DECLARATION, spentW3);
    const churn = [
      {},
      { candidate_revision: "0".repeat(40) },
      { candidate_revision: "1".repeat(40) },
      { lease_generation: 7 },
      { assigned_role: "explorer" },
      { assigned_role: "park-ranger" },
      { session: "fresh-session-b" },
      { resumed: true },
    ];
    for (const extra of churn) {
      const verdict = viaTransition(request(fx, extra));
      assert.equal(verdict.outcome, "BLOCK", JSON.stringify(extra));
      assert.match(String(verdict.reason), /assurance_budget:HALT:assurance_round_limit/, JSON.stringify(extra));
    }

    // Renaming the declared wave's display name is the same unit, not a new one.
    const renamed = fixture({ waves: [{ id: "W3", name: "renamed third" }, { id: "W4" }] }, spentW3);
    assert.match(
      String(viaTransition(request(renamed)).reason),
      /assurance_budget:HALT:assurance_round_limit/
    );

    // A completed repair with a deterministic PASS still closes the unit.
    const closed = fixture(WAVE_DECLARATION, [
      {
        unit_kind: "wave",
        assurance_unit: "W3",
        assurance_rounds: 1,
        assurance_repairs: 1,
        deterministic_gate: "PASS",
      },
    ]);
    assert.match(
      String(viaTransition(request(closed)).reason),
      /assurance_budget:HALT:assurance_round_limit/
    );
  });

  it("T-LITE-01R: the hook POLICY is an exact mirror of the declared assurance policy", () => {
    const document = readFileSync(
      path.join(ROOT, "skills/bearing-lite/references/assurance-policy.md"),
      "utf8"
    );
    const documented = JSON.parse(document.match(/```json\n([\s\S]*?)\n```/)[1]);
    const { POLICY } = budgetHook();
    assert.deepEqual(POLICY, documented);
    assert.equal(POLICY.budget_scope, "per_declared_phase_or_wave");
    assert.equal(POLICY.review_rounds, 1);
    assert.equal(POLICY.aggregated_repairs_max, 1);
  });

  it("T-LITE-03R: a second aggregate repair and a missing deterministic gate both HALT", () => {
    const second = fixture(WAVE_DECLARATION, [
      { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 2 },
    ]);
    assert.match(
      String(viaTransition(request(second)).reason),
      /assurance_budget:HALT:assurance_repair_limit/
    );

    for (const gate of [undefined, "FAIL", "pass", "PENDING"]) {
      const unit = { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 1 };
      if (gate !== undefined) unit.deterministic_gate = gate;
      const fx = fixture(WAVE_DECLARATION, [unit]);
      assert.match(
        String(viaTransition(request(fx)).reason),
        /assurance_budget:HALT:deterministic_post_repair_gate_required/,
        String(gate)
      );
    }
  });

  it("T-LITE-04R: automatic rereview and a per-slice request need an owner amendment", () => {
    const fx = fixture(WAVE_DECLARATION, spentW3);
    for (const extra of [{ automatic_rereview_requested: true }, { review_after_repair: true }]) {
      const verdict = viaTransition(request(fx, extra));
      assert.equal(verdict.outcome, "BLOCK", JSON.stringify(extra));
      assert.match(
        String(verdict.reason),
        /assurance_budget:OWNER_AMENDMENT_REQUIRED:automatic_rereview_prohibited/,
        JSON.stringify(extra)
      );
    }

    const open = fixture(WAVE_DECLARATION, []);
    const perSlice = viaTransition(request(open, { request_scope: "slice", slice_id: "S70" }));
    assert.equal(perSlice.outcome, "BLOCK");
    assert.match(
      String(perSlice.reason),
      /assurance_budget:OWNER_AMENDMENT_REQUIRED:automatic_per_slice_review_prohibited/
    );

    // A unit id absent from the frozen declaration fails closed; renaming an id
    // to escape a spent budget never mints a fresh round.
    const undeclared = viaTransition(request(fx, { assurance_unit: "W9" }));
    assert.equal(undeclared.outcome, "BLOCK");
    assert.match(
      String(undeclared.reason),
      /assurance_budget:OWNER_AMENDMENT_REQUIRED:undeclared_review_unit/
    );
  });

  it("T-LITE-05R: a changed candidate revision never resets the unit budget", () => {
    const fx = fixture(WAVE_DECLARATION, spentW3);
    const first = viaTransition(request(fx, { candidate_revision: "a".repeat(40) }));
    const repairCommit = viaTransition(request(fx, { candidate_revision: "b".repeat(40) }));
    assert.equal(first.outcome, "BLOCK");
    assert.equal(repairCommit.outcome, "BLOCK");
    assert.match(String(repairCommit.reason), /assurance_round_limit/);
    assert.equal(
      JSON.stringify(first),
      JSON.stringify(repairCommit),
      "candidate revision is not a key component"
    );
    assert.equal(
      readFileSync(fx.task_record_path, "utf8").includes('"assurance_rounds": 1'),
      true,
      "a changed candidate never lowers the recorded round count"
    );
  });

  it("T-LITE-06R: role, session, and lease generation are absent from the key", () => {
    const fx = fixture(WAVE_DECLARATION, []);
    const baseline = viaTransition(request(fx));
    const variants = [
      { assigned_role: "crewmate" },
      { assigned_role: "surveyor" },
      { session: "session-a" },
      { session: "session-b" },
      { lease_generation: 1 },
      { lease_generation: 99 },
    ];
    for (const extra of variants) {
      assert.equal(
        JSON.stringify(viaTransition(request(fx, extra))),
        JSON.stringify(baseline),
        JSON.stringify(extra)
      );
    }

    const policy = readFileSync(
      path.join(ROOT, "skills/bearing-lite/references/assurance-policy.md"),
      "utf8"
    );
    assert.match(
      policy,
      /records no route, provider, model, harness, account, or agent identity/
    );
  });

  it("T-LITE-07R: a transport failure is not a spent round", () => {
    const fx = fixture(WAVE_DECLARATION, [
      { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 0, assurance_repairs: 0 },
    ]);
    const before = readFileSync(fx.task_record_path, "utf8");
    for (const verdictToken of ["WAITING_ON", "UNAVAILABLE"]) {
      const result = viaTransition(request(fx, { receipts: [{ verdict: verdictToken }] }));
      assert.equal(result.outcome, "REROUTE", verdictToken);
      assert.match(String(result.reason), /assurance_budget:NEEDS_MORE_EVIDENCE/, verdictToken);
      assert.doesNotMatch(String(result.reason), /HALT/, verdictToken);
    }
    assert.equal(readFileSync(fx.task_record_path, "utf8"), before);

    // A closed verdict on an unspent unit is the round that may be taken.
    assert.equal(viaTransition(request(fx)).outcome, "ADVISE");
  });

  it("T-LITE-08R: malformed input and an unresolved unit never fabricate PASS", () => {
    const declaredWaves = fixture(WAVE_DECLARATION, []);
    const cases = [
      undefined,
      null,
      "",
      42,
      [],
      {},
      { journey: "J" },
      request(declaredWaves, { assurance_unit: undefined }),
      request(declaredWaves, { assurance_unit: "" }),
      { ...request(declaredWaves), declaration_path: path.join(declaredWaves.dir, "absent.json") },
      { ...request(declaredWaves), task_record_path: path.join(declaredWaves.dir, "absent.json") },
    ];
    for (const input of cases) {
      const verdict = viaTransition(input);
      assert.notEqual(verdict.outcome, "ADVISE", JSON.stringify(input));
      assert.doesNotMatch(String(verdict.reason), /:PASS/, JSON.stringify(input));
      assert.ok(
        ["REROUTE", "UNAVAILABLE", "BLOCK"].includes(verdict.outcome),
        `${JSON.stringify(input)} -> ${verdict.outcome}`
      );
    }

    // A single declared phase keys as the phase, never as `direct`.
    const single = fixture(PHASE_DECLARATION, [
      { unit_kind: "phase", assurance_unit: "P1", assurance_rounds: 1, assurance_repairs: 0 },
    ]);
    assert.match(
      String(
        viaTransition(request(single, { unit_kind: "phase", assurance_unit: "P1", request_scope: "phase" }))
          .reason
      ),
      /assurance_budget:HALT:assurance_round_limit/
    );

    // A legacy record with no unit id derives once as the single direct unit and
    // never lowers the spent count it already shows.
    const legacy = fixture(NO_UNIT_DECLARATION, [{ assurance_rounds: 1, assurance_repairs: 1, deterministic_gate: "PASS" }]);
    const derived = viaTransition({
      journey: "J",
      unit_kind: "direct",
      request_scope: "direct",
      declaration_path: legacy.declaration_path,
      task_record_path: legacy.task_record_path,
    });
    assert.equal(derived.outcome, "BLOCK");
    assert.match(String(derived.reason), /assurance_budget:HALT:assurance_round_limit/);
  });

  it("W14-R5: task-record lookup uses the full journey, kind, and unit key", () => {
    const fx = fixture(WAVE_DECLARATION, spentW3);
    writeFileSync(
      fx.task_record_path,
      JSON.stringify({ journey: "OTHER", units: spentW3 }, null, 2)
    );

    assert.equal(
      budgetHook().evaluateAssuranceBudget(request(fx)).outcome,
      "NEEDS_MORE_EVIDENCE"
    );
  });

  it("W14-R6: invalid assurance counters fail closed", () => {
    for (const field of ["assurance_rounds", "assurance_repairs"]) {
      for (const value of ["corrupt", 1.5, -1]) {
        const unit = {
          unit_kind: "wave",
          assurance_unit: "W3",
          assurance_rounds: 0,
          assurance_repairs: 0,
          [field]: value,
        };
        const fx = fixture(WAVE_DECLARATION, [unit]);
        const verdict = budgetHook().evaluateAssuranceBudget(request(fx));
        assert.equal(verdict.outcome, "NEEDS_MORE_EVIDENCE", `${field}=${value}`);
      }
    }
  });
});

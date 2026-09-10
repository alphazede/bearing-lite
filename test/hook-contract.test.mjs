/**
 * CMD-HOOK-01 / SEIT-HOOK-CLASS-01, SEIT-HOOK-COVERAGE-01
 * The four original hook classes; outcomes ADVISE|REROUTE|BLOCK|UNAVAILABLE;
 * coverage honesty.
 *
 * CMD-LITE-TE-HOOK-TEST / SEIT-EMV-017 amendment: the Test Engineering classes
 * `te_test_write` and `te_completion` ship as *additional* classes in
 * `hooks/te-capability.cjs` and `hooks/te-host.cjs`
 * (ROUTER-EMV-003-001 `exact_write_sets.Lite_product`). They do not replace,
 * rename, or extend the original four, and they do not reuse the original four
 * outcomes. The module list below is therefore open to those two TE files and
 * closed to everything else; it is no longer an "exactly four .cjs files"
 * assertion.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = path.join(ROOT, "hooks");
const require = createRequire(import.meta.url);

/** Temp fixture roots for the per-declared-unit assurance cases. */
const assuranceTempDirs = [];
after(() => {
  for (const dir of assuranceTempDirs) rmSync(dir, { recursive: true, force: true });
});

const EXPECTED_CLASSES = new Set([
  "activation",
  "closeout",
  "transition",
  "protected_action",
]);
const ORIGINAL_CLASS_FILES = Object.freeze([
  "activation.cjs",
  "closeout.cjs",
  "protected-action.cjs",
  "transition-order.cjs",
]);
/**
 * Shared pure evaluators consumed by an existing class adapter. They declare no
 * HOOK_CLASS and register no host event, so they are not hook-class modules:
 * `planning-review.cjs` is consumed by transition and closeout, and
 * `assurance-budget.cjs` is consumed by transition through the
 * `assurance_transition` action_kind (ROUTER-EMV-CADENCE-IMPLEMENTATION-001).
 */
const EVALUATOR_MODULES = new Set(["planning-review.cjs", "assurance-budget.cjs"]);
/** Additional TE class modules, allowed but not yet required by this case. */
const TE_CLASS_FILES = Object.freeze(["te-capability.cjs", "te-host.cjs"]);
const TE_CLASSES = Object.freeze(["te_test_write", "te_completion"]);
const ALLOWED_OUTCOMES = new Set(["ADVISE", "REROUTE", "BLOCK", "UNAVAILABLE"]);

const activation = require(path.join(HOOKS_DIR, "activation.cjs"));
const closeout = require(path.join(HOOKS_DIR, "closeout.cjs"));
const transition = require(path.join(HOOKS_DIR, "transition-order.cjs"));
const protectedAction = require(path.join(HOOKS_DIR, "protected-action.cjs"));

const HOOKS = [
  { file: "activation.cjs", mod: activation, className: "activation" },
  { file: "closeout.cjs", mod: closeout, className: "closeout" },
  { file: "transition-order.cjs", mod: transition, className: "transition" },
  { file: "protected-action.cjs", mod: protectedAction, className: "protected_action" },
];

/**
 * Client capability coverage model.
 * @param {'full'|'partial'|'skills-only'} client
 * @param {{ claimExecutable?: string[] }} [opts]
 */
export function reportHookCoverage(client, opts = {}) {
  /** @type {Record<string, { executable: boolean, procedural: boolean }>} */
  const coverage = {};
  for (const cls of EXPECTED_CLASSES) {
    if (client === "full") {
      coverage[cls] = { executable: true, procedural: true };
    } else if (client === "partial") {
      // Partial: activation+closeout executable; transition+protected procedural only.
      const exec = cls === "activation" || cls === "closeout";
      coverage[cls] = { executable: exec, procedural: true };
    } else {
      coverage[cls] = { executable: false, procedural: true };
    }
  }
  /** @type {{ code: string, message: string }[]} */
  const diagnostics = [];
  for (const claimed of opts.claimExecutable || []) {
    if (!coverage[claimed]?.executable) {
      diagnostics.push({
        code: "unsupported_class_claimed_executable",
        message: `client ${client} cannot claim class "${claimed}" as executable enforcement`,
      });
    }
  }
  if (diagnostics.length) {
    return { ok: false, client, coverage, diagnostics };
  }
  return { ok: true, client, coverage, diagnostics: [] };
}

describe("CMD-HOOK-01 hook-contract (SEIT-HOOK-CLASS-01, SEIT-HOOK-COVERAGE-01)", () => {
  it("ships the four original hook class modules under hooks/", () => {
    const files = readdirSync(HOOKS_DIR)
      .filter((f) => f.endsWith(".cjs") && !EVALUATOR_MODULES.has(f))
      .sort();
    for (const required of ORIGINAL_CLASS_FILES) {
      assert.ok(files.includes(required), `hooks/${required} must ship`);
    }
    // Open to the two Router-authorized TE modules; closed to anything else.
    const allowed = new Set([...ORIGINAL_CLASS_FILES, ...TE_CLASS_FILES]);
    for (const file of files) {
      assert.ok(allowed.has(file), `unauthorized hook module hooks/${file}`);
    }
    const classes = new Set(HOOKS.map((h) => h.mod.HOOK_CLASS));
    assert.deepEqual([...classes].sort(), [...EXPECTED_CLASSES].sort());
    assert.equal(classes.size, 4);
  });

  it("TE ships te_test_write and te_completion as additional distinct classes", () => {
    for (const file of TE_CLASS_FILES) {
      assert.ok(
        existsSync(path.join(HOOKS_DIR, file)),
        `hooks/${file} must exist (ROUTER-EMV-003-001 exact_write_sets.Lite_product)`
      );
    }
    const teHost = require(path.join(HOOKS_DIR, "te-host.cjs"));
    const teCapability = require(path.join(HOOKS_DIR, "te-capability.cjs"));

    assert.deepEqual([...teHost.TE_CLASSES].sort(), [...TE_CLASSES].sort());
    assert.equal(teCapability.CAPABILITY, "test-engineering");

    // Additional, not replacements: no overlap with the original four classes,
    // and no reuse of the original four outcome tokens as TE verdicts.
    for (const teClass of teHost.TE_CLASSES) {
      assert.ok(!EXPECTED_CLASSES.has(teClass), `${teClass} collides with an original class`);
    }
    for (const original of HOOKS) {
      assert.ok(
        !teHost.TE_CLASSES.includes(original.mod.HOOK_CLASS),
        original.file
      );
      for (const outcome of original.mod.OUTCOMES) {
        assert.ok(ALLOWED_OUTCOMES.has(outcome), `${original.file} ${outcome}`);
      }
    }
    for (const verdict of teHost.VERDICTS) {
      assert.ok(
        !ALLOWED_OUTCOMES.has(verdict) || verdict === "UNAVAILABLE",
        `TE verdict ${verdict} must not reuse an original-four outcome`
      );
    }
    assert.ok(teHost.VERDICTS.includes("DENY_ROUTE_TO_TE"));
    assert.ok(teHost.VERDICTS.includes("DENY_RECEIPT_REQUIRED"));
  });

  it("each hook exports evaluate() and OUTCOMES limited to ADVISE|REROUTE|BLOCK|UNAVAILABLE", () => {
    for (const h of HOOKS) {
      assert.equal(typeof h.mod.evaluate, "function", h.file);
      assert.ok(Array.isArray(h.mod.OUTCOMES) || h.mod.OUTCOMES instanceof Array);
      for (const o of h.mod.OUTCOMES) {
        assert.ok(ALLOWED_OUTCOMES.has(o), `${h.file} unexpected outcome ${o}`);
      }
      assert.equal(h.mod.HOOK_CLASS, h.className);
    }
  });

  it("activation is advisory (ADVISE) and never fabricates BLOCK for incomplete context", () => {
    const incomplete = activation.evaluate({
      plan_present: false,
      router_invoked: false,
    });
    assert.equal(incomplete.hook_class, "activation");
    assert.equal(incomplete.outcome, "ADVISE");
    assert.notEqual(incomplete.outcome, "BLOCK");

    const ready = activation.evaluate({
      plan_present: true,
      next_action_known: true,
      assigned_role: "crewmate",
      router_invoked: true,
      missing_planning_stages: [],
    });
    assert.equal(ready.outcome, "ADVISE");
    assert.match(String(ready.reason), /context_ready/);
  });

  it("closeout advisory vs narrow BLOCK for protected completion", () => {
    const handoff = {
      verdict: "PASS",
      candidate_ref: "cand-abc",
      changed_paths: ["test/hook-contract.test.mjs"],
      tests: "ok",
      findings: "none",
      blocker: "none",
    };
    const advisory = closeout.evaluate({
      handoff,
      required_assurance: "none",
      assurance_accepted: [],
      candidate_matched: true,
    });
    assert.equal(advisory.outcome, "ADVISE");
    assert.equal(advisory.reason, "handoff_complete");

    const intentOnly = closeout.evaluate({
      outcome: "PASS",
      candidate_ref: "cand-abc",
      changed_paths: ["test/hook-contract.test.mjs"],
      tests: "ok",
      findings: "none",
      blocker: "none",
    });
    assert.equal(intentOnly.outcome, "ADVISE");
    assert.equal(intentOnly.reason, "handoff_incomplete:verdict");

    const invalidVerdict = closeout.evaluate({
      verdict: "pass",
      candidate_ref: "cand-abc",
      changed_paths: ["test/hook-contract.test.mjs"],
      tests: "ok",
      findings: "none",
      blocker: "none",
    });
    assert.equal(invalidVerdict.outcome, "ADVISE");
    assert.equal(invalidVerdict.reason, "handoff_invalid:verdict");
    assert.match(String(invalidVerdict.recovery), /PASS/);
    assert.notEqual(invalidVerdict.reason, "handoff_incomplete:verdict");

    const protectedInvalid = closeout.evaluate({
      mode: "protected_completion",
      verdict: "pass",
      candidate_ref: "cand-abc",
      changed_paths: ["test/hook-contract.test.mjs"],
      tests: "ok",
      findings: "none",
      blocker: "none",
      required_assurance: [],
      assurance_accepted: [],
      candidate_matched: true,
    });
    assert.equal(protectedInvalid.outcome, "BLOCK");
    assert.match(String(protectedInvalid.reason), /protected_completion_invalid:handoff:verdict/);

    const blocked = closeout.evaluate({
      mode: "protected_completion",
      handoff,
      required_assurance: ["Validator"],
      assurance_accepted: [],
      candidate_matched: false,
    });
    assert.equal(blocked.outcome, "BLOCK");
    assert.match(String(blocked.reason), /protected_completion_invalid/);
  });

  it("transition reroutes illegal edges; BLOCKs only narrow sequence violations", () => {
    const reroute = transition.evaluate({
      from_state: "IN_PROGRESS",
      to_state: "COMPLETE",
      prerequisites_met: true,
    });
    assert.equal(reroute.outcome, "REROUTE");

    const hard = transition.evaluate({
      from_state: "ACCEPTANCE",
      to_state: "COMPLETE",
      prerequisites_met: true,
      skip_required_step: true,
      after_reroute: true,
      required_assurance: ["Validator"],
      assurance_completed: [],
    });
    assert.equal(hard.outcome, "BLOCK");
  });

  it("protected_action BLOCKs explicit violations; safe channels remain open", () => {
    const clear = protectedAction.evaluate({ protected_action: "publish", owner_authorized: true });
    assert.equal(clear.outcome, "ADVISE");

    const secret = protectedAction.evaluate({
      protected_action: "export",
      secret_exposure: true,
    });
    assert.equal(secret.outcome, "BLOCK");

    for (const channel of ["repair", "status", "owner_communication", "safe_rollback"]) {
      const open = protectedAction.evaluate({ channel });
      assert.equal(open.outcome, "ADVISE", channel);
      assert.match(String(open.reason), /channel_open/);
    }
  });

  it("client capability fixtures: full / partial / skills-only report honest coverage", () => {
    const full = reportHookCoverage("full");
    assert.equal(full.ok, true);
    for (const cls of EXPECTED_CLASSES) {
      assert.equal(full.coverage[cls].executable, true);
    }

    const partial = reportHookCoverage("partial");
    assert.equal(partial.ok, true);
    assert.equal(partial.coverage.activation.executable, true);
    assert.equal(partial.coverage.transition.executable, false);
    assert.equal(partial.coverage.transition.procedural, true);

    const skillsOnly = reportHookCoverage("skills-only");
    assert.equal(skillsOnly.ok, true);
    for (const cls of EXPECTED_CLASSES) {
      assert.equal(skillsOnly.coverage[cls].executable, false);
      assert.equal(skillsOnly.coverage[cls].procedural, true);
    }
  });

  it("verified Claude Code / Codex hosts report the documented partial coverage", () => {
    const host = require(path.join(HOOKS_DIR, "com.anthropic.claude-code/host.cjs"));
    const expected = reportHookCoverage("partial");
    assert.equal(expected.ok, true);
    assert.deepEqual(host.COVERAGE, expected.coverage);
    assert.equal(host.COVERAGE.transition.executable, false);
    assert.equal(host.COVERAGE.protected_action.executable, false);
  });

  it("negative: claiming unsupported class as executable enforcement fails", () => {
    const verdict = reportHookCoverage("skills-only", {
      claimExecutable: ["protected_action", "transition"],
    });
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.diagnostics.some((d) => d.code === "unsupported_class_claimed_executable")
    );

    const partialBad = reportHookCoverage("partial", {
      claimExecutable: ["protected_action"],
    });
    assert.equal(partialBad.ok, false);
  });
  /**
   * ROUTER-EMV-CADENCE-IMPLEMENTATION-001 / PROC-CADENCE-UNIT-BUDGET (S70).
   * The per-declared-phase-or-wave assurance budget joins the enumerated hook
   * contract as a second pure evaluator behind the existing `transition` class.
   * No new hook class and no new host event. RED until S71 ships
   * `hooks/assurance-budget.cjs`, the `assurance_transition` action_kind, and
   * the corrected `hooks/com.anthropic.claude-code/mapping.md` text.
   */
  const assuranceFixture = (units, declaration = { waves: [{ id: "W3" }, { id: "W4" }] }) => {
    const dir = mkdtempSync(path.join(tmpdir(), "lite-hook-assurance-"));
    assuranceTempDirs.push(dir);
    const declaration_path = path.join(dir, "declaration.json");
    const task_record_path = path.join(dir, "task-record.json");
    writeFileSync(declaration_path, JSON.stringify(declaration));
    writeFileSync(task_record_path, JSON.stringify({ journey: "J", units }));
    return {
      journey: "J",
      unit_kind: "wave",
      assurance_unit: "W3",
      request_scope: "wave",
      declaration_path,
      task_record_path,
    };
  };
  const SPENT_W3 = [
    { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 0 },
  ];

  it("T-LITE-09R: assurance_transition delegates to the assurance-budget evaluator", () => {
    const budget = require(path.join(HOOKS_DIR, "assurance-budget.cjs"));
    assert.equal(typeof budget.evaluateAssuranceBudget, "function");
    assert.equal(budget.HOOK_CLASS, undefined, "the evaluator declares no hook class");

    const open = assuranceFixture([]);
    const spent = assuranceFixture(SPENT_W3);
    const repairTwice = assuranceFixture([
      { unit_kind: "wave", assurance_unit: "W3", assurance_rounds: 1, assurance_repairs: 2 },
    ]);
    const pending = { ...open, receipts: [{ verdict: "WAITING_ON" }] };
    const rereview = { ...spent, automatic_rereview_requested: true };

    /** @type {Array<[object, string, string]>} */
    const mapping = [
      [open, "ADVISE", "PASS"],
      [pending, "REROUTE", "NEEDS_MORE_EVIDENCE"],
      [spent, "BLOCK", "HALT"],
      [repairTwice, "BLOCK", "HALT"],
      [rereview, "BLOCK", "OWNER_AMENDMENT_REQUIRED"],
    ];
    for (const [assurance, outcome, verdictName] of mapping) {
      const evaluated = budget.evaluateAssuranceBudget(assurance);
      assert.equal(evaluated.outcome, verdictName, JSON.stringify(assurance));
      const adapted = transition.evaluate({ action_kind: "assurance_transition", assurance });
      assert.equal(adapted.hook_class, "transition", "no new hook class");
      assert.ok(ALLOWED_OUTCOMES.has(adapted.outcome), adapted.outcome);
      assert.equal(adapted.outcome, outcome, JSON.stringify(assurance));
      assert.match(String(adapted.reason), /^assurance_budget:/);
      assert.match(String(adapted.reason), new RegExp(verdictName));
    }
    // Same shape as the planning_review_transition branch it mirrors.
    assert.equal(transition.HOOK_CLASS, "transition");
    assert.deepEqual([...transition.OUTCOMES].sort(), [...ALLOWED_OUTCOMES].sort());
  });

  it("T-LITE-10R / W14-R4: EVIDENCE_READY -> REVIEWING without assurance fails closed", () => {
    const spent = assuranceFixture(SPENT_W3);
    const edge = (assurance) =>
      transition.evaluate({
        from_state: "EVIDENCE_READY",
        to_state: "REVIEWING",
        prerequisites_met: true,
        assurance,
      });

    const closedLoop = edge(spent);
    assert.equal(closedLoop.outcome, "REROUTE");
    assert.match(String(closedLoop.reason), /assurance_round_limit/);

    const nextUnit = edge({ ...spent, assurance_unit: "W4" });
    assert.equal(nextUnit.outcome, "ADVISE");
    assert.match(String(nextUnit.reason), /transition_allowed:EVIDENCE_READY->REVIEWING/);

    // The legal edge table itself is unchanged; only the per-unit budget bounds it.
    assert.ok(transition.LEGAL.EVIDENCE_READY.includes("REVIEWING"));
    assert.ok(transition.LEGAL.REVIEWING.includes("EVIDENCE_READY"));
    const missing = edge(undefined);
    assert.notEqual(missing.outcome, "ADVISE");
    assert.equal(missing.outcome, "REROUTE");
    assert.equal(
      missing.reason,
      "assurance_budget:NEEDS_MORE_EVIDENCE:assurance_request_missing"
    );
  });

  it("W12-R4: Assurance Test Engineer reaches the VALIDATING assurance state", () => {
    const edge = (role) =>
      transition.evaluate({
        from_state: "EVIDENCE_READY",
        to_state: "VALIDATING",
        prerequisites_met: true,
        required_assurance: [role],
        assurance_completed: [],
      });

    const retired = edge("Validator");
    assert.equal(retired.outcome, "ADVISE");

    const current = edge("Assurance Test Engineer");
    assert.equal(current.outcome, "ADVISE");
    assert.match(String(current.reason), /transition_allowed:EVIDENCE_READY->VALIDATING/);
  });

  it("T-LITE-11: safe channels stay ADVISE while the unit budget is exhausted", () => {
    const spent = assuranceFixture(SPENT_W3);
    assert.equal(
      transition.evaluate({ action_kind: "assurance_transition", assurance: spent }).outcome,
      "BLOCK",
      "the unit budget must actually be exhausted for this case to mean anything"
    );
    for (const channel of ["repair", "status", "owner_communication", "safe_rollback"]) {
      for (const key of ["channel", "action_kind"]) {
        const open = transition.evaluate({ [key]: channel, assurance: spent });
        assert.equal(open.outcome, "ADVISE", `${key}=${channel}`);
        assert.match(String(open.reason), /channel_open/, `${key}=${channel}`);
      }
    }
  });

  it("T-LITE-13: the host mapping keeps the per-unit assurance record honest", () => {
    const mapping = readFileSync(
      path.join(HOOKS_DIR, "com.anthropic.claude-code", "mapping.md"),
      "utf8"
    );
    assert.match(mapping, /assurance/i, "the mapping must classify the per-unit assurance record");
    for (const host of ["Claude Code", "Codex", "Grok Build", "Cursor", "Kimi Code"]) {
      assert.match(
        mapping,
        new RegExp(`\\| ${host} \\|[^\n]*\\| partial \\|`),
        `${host} must stay partial`
      );
    }
    for (const host of ["AGY", "Pi", "DeepCode"]) {
      assert.match(
        mapping,
        new RegExp(`\\| ${host} \\|[^\n]*\\| skills-only \\|`),
        `${host} must stay skills-only`
      );
    }
    assert.doesNotMatch(
      mapping,
      /native[^.\n]*assurance (budget|enforcement|record)/i,
      "no host may claim native assurance enforcement"
    );
    assert.match(
      mapping,
      /assurance[\s\S]{0,400}procedural/i,
      "the per-unit assurance record stays procedural on every mapped host"
    );
  });
});

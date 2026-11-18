// S14T (Bearing 3.0, W3): promotion evaluator N04 over replay receipts (DES-F11).
// Oracle: DEC-07 (workspace.md), boundary contract F11 data_contract and
// failure_recovery, assembly-strategy V-F11; SEIT-B30-216, SEIT-F11,
// SEIT-EXP-PROMOTION, SEIT-B30-119, SEIT-B30-315. Every expected outcome below
// is worked out by hand from the DEC-07 text, never from the evaluator.
//
// Public entry points this file binds (tools/promotion-rule.mjs):
//   evaluatePromotion({ baseline: Run[], candidate: Run[] }) -> Report   (pure)
//   CLI: node tools/promotion-rule.mjs --baseline <dir> --candidate <dir>
//        prints the same Report as JSON on stdout; exit 0 for promote and for
//        no_promote (CMD-EXP-PROMOTION pass rule). Every *.json file in a
//        directory is one Run.
// Run (one replay receipt):
//   { workload_digest, task, repetition, package_digest, route?,
//     gates: { <gate>: "PASS" | "FAIL" },
//     seeded_defects: { <defect>: true (found) | false (missed) },
//     violations: { authority: n, write_set: n },
//     fresh_tokens, integrated_slices, errors, elapsed_ms, owner_asks,
//     required_evidence?: ["calibration" | "egress"],
//     evidence?: { calibration?: { qualified: boolean }, egress?: {...} } }
// Report:
//   { decision: "promote" | "no_promote",
//     reasons: string[]        // empty on promote; codes below on no_promote
//     terms: { gates_preserved, seeded_defects_found, no_violations,
//              fresh_tokens_lower }: each { satisfied: boolean }
//     arms: { baseline|candidate: { runs, median_fresh_tokens_per_integrated_slice,
//              errors, elapsed_ms, owner_asks } },
//     recommendation: "adopt_candidate" | "keep_current_default" }
// Reason codes: gate_regression, seeded_defect_missed, violation,
// fresh_tokens_not_lower, missing_evidence, incomparable_workload,
// unqualified_calibration.
// DEC-07 reading (SEIT-EXP-PROMOTION dec07_operationalization): runs pair by
// (task, repetition); a quality regression in any pair blocks promotion; the
// token term compares the medians over all runs of fresh_tokens / integrated_slices.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools/promotion-rule.mjs");
// Loaded per test so a missing module fails each case by name (expected-red baseline).
const evaluate = async (input) => (await import(pathToFileURL(TOOL).href)).evaluatePromotion(input);

const TERMS = ["gates_preserved", "seeded_defects_found", "no_violations", "fresh_tokens_lower"];
const WORKLOAD = "a".repeat(64);
const TASKS = ["T1", "T2"];
const REPS = [1, 2, 3];
// Baseline: 2 integrated slices per run, fresh_tokens 2000..3000 step 200,
// so per-slice values 1000..1500 step 100 and median (1200 + 1300) / 2 = 1250.
const BASE_TOKENS = [2000, 2200, 2400, 2600, 2800, 3000];
// Candidate: per-slice values 900..1150 step 50, median (1000 + 1050) / 2 = 1025.
const LOWER_TOKENS = [1800, 1900, 2000, 2100, 2200, 2300];
// Higher: baseline + 200 each, per-slice 1100..1600, median 1350.
const HIGHER_TOKENS = BASE_TOKENS.map((v) => v + 200);

function arm(tokens, over = () => ({}), pkg = "b".repeat(64)) {
  const runs = [];
  let i = 0;
  for (const task of TASKS) {
    for (const repetition of REPS) {
      const run = {
        workload_digest: WORKLOAD,
        task,
        repetition,
        package_digest: pkg,
        route: { harness: "Harness-Canary-7q", model: "model-canary-3x" },
        // g3 fails in the baseline on purpose: it never counts against the candidate.
        gates: { g1: "PASS", g2: "PASS", g3: "FAIL" },
        // d3 is missed by the baseline on purpose: the candidate need not find it.
        seeded_defects: { d1: true, d2: true, d3: false },
        violations: { authority: 0, write_set: 0 },
        fresh_tokens: tokens[i],
        integrated_slices: 2,
        errors: 1,
        elapsed_ms: 1000,
        owner_asks: i === 0 ? 1 : 0,
      };
      Object.assign(run, over(run, i));
      runs.push(run);
      i += 1;
    }
  }
  return runs;
}
const baseline = () => arm(BASE_TOKENS);
const candidate = (over) => arm(LOWER_TOKENS, over, "c".repeat(64));
const onePair = (fn) => (run) => (run.task === "T2" && run.repetition === 2 ? fn(run) : {});

function assertReport(report, decision, reasons) {
  assert.equal(report.decision, decision, JSON.stringify(report));
  for (const term of TERMS) {
    assert.equal(typeof report.terms?.[term]?.satisfied, "boolean", `term ${term} reported: ${JSON.stringify(report.terms)}`);
  }
  if (decision === "promote") {
    assert.deepEqual(report.reasons, []);
    assert.equal(report.recommendation, "adopt_candidate");
  } else {
    for (const reason of reasons) assert.ok(report.reasons.includes(reason), `reason ${reason} in ${JSON.stringify(report.reasons)}`);
    assert.equal(report.recommendation, "keep_current_default", "no promotion keeps the current default");
  }
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("DEC-07 promotion predicate, eight worked fixtures (SEIT-B30-216)", () => {
  it("1. all four terms satisfied promotes", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate() });
    assertReport(report, "promote");
    for (const term of TERMS) assert.equal(report.terms[term].satisfied, true, term);
  });

  it("2. one baseline-passing gate failing in one pair does not promote", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair((r) => ({ gates: { ...r.gates, g2: "FAIL" } }))) });
    assertReport(report, "no_promote", ["gate_regression"]);
    assert.equal(report.terms.gates_preserved.satisfied, false);
    assert.equal(report.terms.fresh_tokens_lower.satisfied, true, "other terms are still reported on their own evidence");
  });

  it("3. one baseline-found seeded defect missed in one pair does not promote", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair((r) => ({ seeded_defects: { ...r.seeded_defects, d1: false } }))) });
    assertReport(report, "no_promote", ["seeded_defect_missed"]);
    assert.equal(report.terms.seeded_defects_found.satisfied, false);
  });

  it("4. one write-set violation in one pair does not promote", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair(() => ({ violations: { authority: 0, write_set: 1 } }))) });
    assertReport(report, "no_promote", ["violation"]);
    assert.equal(report.terms.no_violations.satisfied, false);
  });

  it("5. equal median fresh_tokens per integrated slice does not promote (lower is required)", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: arm(BASE_TOKENS, undefined, "c".repeat(64)) });
    assertReport(report, "no_promote", ["fresh_tokens_not_lower"]);
    assert.equal(report.terms.fresh_tokens_lower.satisfied, false);
    assert.equal(report.arms.baseline.median_fresh_tokens_per_integrated_slice, 1250);
    assert.equal(report.arms.candidate.median_fresh_tokens_per_integrated_slice, 1250);
  });

  it("6. higher median fresh_tokens per integrated slice does not promote", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: arm(HIGHER_TOKENS, undefined, "c".repeat(64)) });
    assertReport(report, "no_promote", ["fresh_tokens_not_lower"]);
    assert.equal(report.arms.candidate.median_fresh_tokens_per_integrated_slice, 1350);
  });

  it("7. a missing candidate gate result is missing evidence, never a pass", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair((r) => ({ gates: { g1: r.gates.g1, g3: r.gates.g3 } }))) });
    assertReport(report, "no_promote", ["missing_evidence"]);
  });

  it("8. a missing seeded-defect record is missing evidence, never a pass", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair((r) => ({ seeded_defects: { d1: r.seeded_defects.d1, d3: false } }))) });
    assertReport(report, "no_promote", ["missing_evidence"]);
  });
});

describe("DEC-07 edges worked from the rule text (SEIT-B30-216, SEIT-EXP-PROMOTION)", () => {
  it("malformed receipts and invalid mandatory evidence never promote", async () => {
    for (const changes of [
      { gates: [] }, { seeded_defects: [] }, { fresh_tokens: -1 }, { integrated_slices: 1.5 },
      { owner_asks: undefined }, { elapsed_ms: -1 }, { errors: -1 }, { task: undefined },
      { repetition: null }, { required_evidence: "calibration" },
    ]) {
      const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair(() => changes)) });
      assert.equal(report.decision, "no_promote", JSON.stringify(changes));
      assert.ok(report.reasons.includes("missing_evidence"), JSON.stringify(report));
    }
    const report = await evaluate({ baseline: [null], candidate: candidate() });
    assertReport(report, "no_promote", ["missing_evidence"]);
  });

  it("a gate the baseline failed and a defect the baseline missed do not block promotion", async () => {
    // Fixture design: g3 FAIL and d3 missed in both arms; only baseline-passing gates
    // and baseline-found defects are DEC-07 terms.
    const report = await evaluate({ baseline: baseline(), candidate: candidate() });
    assertReport(report, "promote");
  });

  it("an authority violation does not promote; baseline violations do not excuse the candidate", async () => {
    const base = arm(BASE_TOKENS, () => ({ violations: { authority: 1, write_set: 1 } }));
    const report = await evaluate({ baseline: base, candidate: candidate(onePair(() => ({ violations: { authority: 1, write_set: 0 } }))) });
    assertReport(report, "no_promote", ["violation"]);
    assert.equal(report.terms.no_violations.satisfied, false);
  });

  it("a missing (task, repetition) pair is missing evidence", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate().filter((r) => !(r.task === "T1" && r.repetition === 3)) });
    assertReport(report, "no_promote", ["missing_evidence"]);
  });

  it("a missing fresh_tokens or zero integrated_slices metric is missing evidence", async () => {
    for (const fn of [(r) => ({ fresh_tokens: undefined }), () => ({ integrated_slices: 0 })]) {
      const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair(fn)) });
      assertReport(report, "no_promote", ["missing_evidence"]);
    }
  });

  it("empty arms are missing evidence", async () => {
    assertReport(await evaluate({ baseline: [], candidate: [] }), "no_promote", ["missing_evidence"]);
    assertReport(await evaluate({ baseline: baseline(), candidate: [] }), "no_promote", ["missing_evidence"]);
  });

  it("several failing terms are all reported", async () => {
    const report = await evaluate({
      baseline: baseline(),
      candidate: arm(HIGHER_TOKENS, onePair((r) => ({ gates: { ...r.gates, g1: "FAIL" }, violations: { authority: 0, write_set: 2 } })), "c".repeat(64)),
    });
    assertReport(report, "no_promote", ["gate_regression", "violation", "fresh_tokens_not_lower"]);
    assert.equal(report.terms.gates_preserved.satisfied, false);
    assert.equal(report.terms.no_violations.satisfied, false);
    assert.equal(report.terms.fresh_tokens_lower.satisfied, false);
    assert.equal(report.terms.seeded_defects_found.satisfied, true);
  });

  it("is pure: frozen inputs are not mutated and repeat calls give equal reports", async () => {
    const input = deepFreeze({ baseline: baseline(), candidate: candidate() });
    const first = await evaluate(input);
    const second = await evaluate(input);
    assert.deepEqual(first, second);
    assertReport(first, "promote");
  });
});

describe("F11 negative crossings and retained per-arm evidence (SEIT-F11, V-F11)", () => {
  it("positive connection reports per-arm medians, errors, elapsed time and owner asks", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate() });
    assertReport(report, "promote");
    assert.deepEqual(report.arms.baseline, { runs: 6, median_fresh_tokens_per_integrated_slice: 1250, errors: 6, elapsed_ms: 6000, owner_asks: 1 });
    assert.deepEqual(report.arms.candidate, { runs: 6, median_fresh_tokens_per_integrated_slice: 1025, errors: 6, elapsed_ms: 6000, owner_asks: 1 });
  });

  it("incomparable workload (different workload digest) does not promote", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair(() => ({ workload_digest: "e".repeat(64) }))) });
    assertReport(report, "no_promote", ["incomparable_workload"]);
  });

  it("a candidate package that changes between runs is incomparable (frozen package per arm)", async () => {
    const report = await evaluate({ baseline: baseline(), candidate: candidate(onePair(() => ({ package_digest: "f".repeat(64) }))) });
    assertReport(report, "no_promote", ["incomparable_workload"]);
  });

  it("unqualified calibration required by the arm does not promote", async () => {
    const report = await evaluate({
      baseline: baseline(),
      candidate: candidate(() => ({ required_evidence: ["calibration"], evidence: { calibration: { qualified: false } } })),
    });
    assertReport(report, "no_promote", ["unqualified_calibration"]);
  });

  it("absent calibration or egress evidence required by the arm is missing evidence", async () => {
    for (const required of ["calibration", "egress"]) {
      const report = await evaluate({ baseline: baseline(), candidate: candidate(() => ({ required_evidence: [required], evidence: {} })) });
      assertReport(report, "no_promote", ["missing_evidence"]);
    }
  });

  it("qualified calibration and present egress evidence keep a passing arm promotable", async () => {
    const report = await evaluate({
      baseline: baseline(),
      candidate: candidate(() => ({ required_evidence: ["calibration", "egress"], evidence: { calibration: { qualified: true }, egress: { recorded: true } } })),
    });
    assertReport(report, "promote");
  });
});

function tempRoot(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "promotion-rule-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function writeArm(dir, runs) {
  mkdirSync(dir, { recursive: true });
  for (const run of runs) writeFileSync(path.join(dir, `${run.task}-r${run.repetition}.json`), JSON.stringify(run) + "\n");
  return dir;
}
function cli(cwd, args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: "utf8", timeout: 30000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const listing = (dir) => readdirSync(dir, { recursive: true }).map(String).sort();

describe("CMD-EXP-PROMOTION command line over receipt directories (SEIT-B30-216, SEIT-F11, B30-123)", () => {
  it("promote: exit 0, typed JSON report, every term reported, no files written", (t) => {
    const root = tempRoot(t);
    const b = writeArm(path.join(root, "baseline"), baseline());
    const c = writeArm(path.join(root, "candidate"), candidate());
    const before = listing(root);
    const r = cli(root, ["--baseline", b, "--candidate", c]);
    assert.equal(r.status, 0, r.stderr);
    assertReport(JSON.parse(r.stdout), "promote");
    assert.deepEqual(listing(root), before, "report only: no default, profile or receipt mutation (F11 side_effects)");
  });

  it("no_promote: exit 0 with the typed result and reasons", (t) => {
    const root = tempRoot(t);
    const b = writeArm(path.join(root, "baseline"), baseline());
    const c = writeArm(path.join(root, "candidate"), arm(BASE_TOKENS, undefined, "c".repeat(64)));
    const r = cli(root, ["--baseline", b, "--candidate", c]);
    assert.equal(r.status, 0, r.stderr);
    assertReport(JSON.parse(r.stdout), "no_promote", ["fresh_tokens_not_lower"]);
  });

  it("CLI and pure function agree on the same receipts", async (t) => {
    const root = tempRoot(t);
    const runs = candidate(onePair((r) => ({ seeded_defects: { ...r.seeded_defects, d2: false } })));
    const r = cli(root, ["--baseline", writeArm(path.join(root, "b"), baseline()), "--candidate", writeArm(path.join(root, "c"), runs)]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), await evaluate({ baseline: baseline(), candidate: runs }));
  });

  it("a missing candidate directory never yields promote", async (t) => {
    await import(pathToFileURL(TOOL).href); // a crashing or absent tool must not pass this case
    const root = tempRoot(t);
    const b = writeArm(path.join(root, "baseline"), baseline());
    const r = cli(root, ["--baseline", b, "--candidate", path.join(root, "absent")]);
    if (r.status === 0) assertReport(JSON.parse(r.stdout), "no_promote", ["missing_evidence"]);
    else assert.ok(!/"decision"\s*:\s*"promote"/.test(r.stdout), r.stdout);
  });

  it("published report names no model or harness from the receipts (role-only public data)", (t) => {
    const root = tempRoot(t);
    const r = cli(root, ["--baseline", writeArm(path.join(root, "b"), baseline()), "--candidate", writeArm(path.join(root, "c"), candidate())]);
    assert.equal(r.status, 0, r.stderr);
    for (const canary of ["Harness-Canary-7q", "model-canary-3x"]) {
      assert.ok(!r.stdout.includes(canary), `report leaks ${canary}`);
      assert.ok(!r.stderr.includes(canary), `stderr leaks ${canary}`);
    }
  });
});

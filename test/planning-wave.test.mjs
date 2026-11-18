/**
 * Future planning contract: one planning wave with one consolidated review
 * (#205), one requires_regate round (#204), per-unit review rounds consumed
 * by both the freeze and the runtime budget (#157), and the Planning
 * Integration Engineer Boundary/Data-Flow Contract (#155). Every case drives
 * the real hook APIs over temp plan directories.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDodManifest, TEMPLATE_VERSION } from "../tools/render-dod-manifest.mjs";
import { planningContract, planningSessions, planningWave, reviewRounds, unreviewedPlanningWave } from "./planning-contract-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { freeze } = require(path.join(ROOT, "hooks/plan-package.cjs"));
const { evaluatePlanningReview } = require(path.join(ROOT, "hooks/planning-review.cjs"));
const { evaluateCorrectionDelta } = require(path.join(ROOT, "hooks/correction-delta.cjs"));
const transition = require(path.join(ROOT, "hooks/transition-order.cjs"));
const PLAN_PACKAGE = path.join(ROOT, "hooks/plan-package.cjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = (prefix) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/** A real plan directory whose seit.json carries proof rows the contract cites. */
function planPackage(mutate = () => {}) {
  const dir = temp("planning-wave-");
  writeFileSync(path.join(dir, ".git"), "fixture repository marker");
  const plan = "# Plan\n";
  writeFileSync(path.join(dir, "plan.md"), plan);
  const seit = JSON.stringify({
    ...JSON.parse(read("test/fixtures/planning-repair-package.json")).seit,
    source_baseline: { planning_inputs: [{ path: "plan.md", sha256: sha(plan) }] },
    proof_cases: ["SEIT-FLOW-1", "SEIT-STATE-1", "SEIT-TRUST-1"].map((id) => ({
      ...JSON.parse(read("test/fixtures/planning-repair-package.json")).seit.proof_cases[0], id,
    })),
  });
  writeFileSync(path.join(dir, "seit.json"), seit);
  const digest = sha([sha(plan), sha(seit)].join("\n"));
  const contract = planningContract(digest, { units: ["W1", "W2"], kind: "wave", dir });
  const doc = {
    journey_settings: { planning_review: { candidate_digest: digest }, ...contract.journey_settings },
    boundary_contract: contract.boundary_contract,
    waves: [{ id: "W1" }, { id: "W2" }],
  };
  mutate(doc, digest, dir);
  writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
  return { dir, digest };
}
const codes = (result) => result.findings.map((finding) => finding.code);

describe("#157 per-unit review rounds frozen by plan-package", () => {
  it("passes one round, at most one repair, and deterministic closure per declared unit", () => {
    assert.deepEqual(freeze(planPackage().dir).findings, []);
  });
  const cases = [
    ["an extra round in one unit", (doc) => { doc.journey_settings.review_rounds[1].reviewer_rounds = 2; }, "review_round_extra"],
    ["a duplicate round for one unit", (doc) => { doc.journey_settings.review_rounds.push(reviewRounds(["W1"], "wave")[1]); }, "review_round_extra"],
    ["a round at no declared boundary", (doc) => { doc.journey_settings.review_rounds.push({ ...reviewRounds(["publication"], "wave")[1] }); }, "review_round_unit_undeclared"],
    ["a unit with no round", (doc) => { doc.journey_settings.review_rounds.pop(); }, "review_round_unit_missing"],
    ["a planning unit with no round", (doc) => { doc.journey_settings.review_rounds.shift(); }, "review_round_unit_missing"],
    ["a second repair", (doc) => { doc.journey_settings.review_rounds[2].repairs_max = 2; }, "review_repair_extra"],
    ["non-deterministic closure", (doc) => { doc.journey_settings.review_rounds[2].closure = "rereview"; }, "review_round_invalid"],
    ["no declaration", (doc) => { delete doc.journey_settings.review_rounds; }, "review_rounds_missing"],
  ];
  for (const [name, mutate, code] of cases) {
    it(`fails the freeze with a typed finding for ${name}`, () => {
      const result = freeze(planPackage(mutate).dir);
      assert.equal(result.outcome, "FAIL");
      assert.ok(codes(result).includes(code), JSON.stringify(result.findings));
    });
  }
});

describe("#157 the runtime budget consumes the same declaration", () => {
  const fixture = (mutate) => {
    const { dir } = planPackage(mutate);
    const task_record_path = path.join(dir, "task-record.json");
    writeFileSync(task_record_path, JSON.stringify({ journey: "J", units: [] }));
    return (assurance_unit, units = []) => {
      writeFileSync(task_record_path, JSON.stringify({ journey: "J", units }));
      return transition.evaluate({
        action_kind: "assurance_transition",
        assurance: {
          journey: "J", unit_kind: "wave", assurance_unit, request_scope: "wave",
          declaration_path: path.join(dir, "implementation.json"), task_record_path,
        },
      });
    };
  };
  it("allows the declared round and halts a second round or repair on the same unit", () => {
    const ask = fixture();
    assert.match(ask("W1").reason, /assurance_budget:PASS/);
    assert.match(ask("W1", [{ unit_id: "W1", assurance_rounds: 1, assurance_repairs: 0 }]).reason, /assurance_round_limit/);
    assert.match(ask("W1", [{ unit_id: "W1", assurance_rounds: 1, assurance_repairs: 2 }]).reason, /assurance_repair_limit/);
  });
  it("never spends implementation budget on the planning unit", () => {
    assert.match(fixture()("planning").reason, /undeclared_review_unit/);
  });
  it("refuses an invalid declaration instead of falling back to defaults", () => {
    const ask = fixture((doc) => { doc.journey_settings.review_rounds.pop(); });
    assert.match(ask("W1").reason, /review_round_declaration_invalid/);
  });
});

describe("#205 one planning wave, one consolidated review", () => {
  const MANIFEST = temp("planning-wave-manifest-");
  writeFileSync(path.join(MANIFEST, "plan-dod-manifest.html"), "<!doctype html><title>DoD</title>");
  const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: "d1" };
  const review = (extra = {}) => ({
    candidate,
    plan_dir: MANIFEST,
    dod_manifest: { output_name: "plan-dod-manifest.html" },
    planning_wave: planningSessions(candidate, ["mbse", "integration_test"]),
    reviewer_slots: [{ slot_id: "slot-a", primary_route_ref: "route-a", fallback_route_refs: [] }],
    round_number: 1,
    completed_rounds: 1,
    receipts: [{ slot_id: "slot-a", selected_route_ref: "route-a", ...candidate, independent: true, findings_isolated: true }],
    aggregation_complete: true,
    aggregated_repairs: 1,
    deterministic_gate: "PASS",
    ...extra,
  });

  it("keeps an unrepaired Requirements Engineer return a gap: the author self-repairs before READY (F4)", () => {
    for (const verdict of ["REPAIRABLE_FAILURE", "NEEDS_MORE_EVIDENCE", "OWNER_DECISION_REQUIRED"]) {
      const wave = review().planning_wave;
      wave.sessions[0].verdict = verdict;
      assert.deepEqual(evaluatePlanningReview(review({ planning_wave: wave, completed_rounds: 0 })), {
        outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete",
      }, verdict);
    }
    const ready = review().planning_wave;
    ready.sessions[1].verdict = "CANDIDATE_READY"; // Integration and Test planning vocabulary
    assert.deepEqual(evaluatePlanningReview(review({ planning_wave: ready, completed_rounds: 0 })), {
      outcome: "NEEDS_MORE_EVIDENCE", reason: "review_round_pending",
    });
  });
  it("one review plus one repair with deterministic closure closes the wave", () => {
    assert.deepEqual(evaluatePlanningReview(review()), { outcome: "PASS", reason: "repair_gate_passed" });
  });
  it("refuses to open the review until every declared session has returned", () => {
    const missing = review().planning_wave;
    missing.sessions.pop();
    const pending = review().planning_wave;
    pending.sessions[1].verdict = "WAITING_ON";
    const stale = review().planning_wave;
    stale.sessions[0].candidate_ref = "older-plan";
    for (const planning_wave of [undefined, missing, pending, stale]) {
      assert.deepEqual(evaluatePlanningReview(review({ planning_wave, completed_rounds: 0 })), {
        outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete",
      });
    }
    const viaTransition = transition.evaluate({
      action_kind: "planning_review_transition", planning_review: review({ planning_wave: missing }),
    });
    assert.match(viaTransition.reason, /planning_sessions_incomplete/);
  });
  it("rejects an unknown, duplicate, or incomplete session declaration", () => {
    const declared = (names) => ({ ...planningSessions(candidate, names) });
    for (const planning_wave of [
      declared(["integration_test", "scribe"]),
      declared(["planning_and_design", "integration_test"]), // retired: the controller's own procedure
      declared(["requirements_engineer"]), // removed in #580
      declared(["systems_modeler"]), // removed in #580
      declared(["test_engineer"]), // planning session removed in #580
      declared(["integration_engineer"]), // planning session removed in #580
      declared(["plan_integrator"]),
      { ...declared(["mbse", "integration_test"]),
        required_sessions: ["mbse", "integration_test", "integration_test"] },
    ]) {
      assert.deepEqual(evaluatePlanningReview(review({ planning_wave })), {
        outcome: "OWNER_AMENDMENT_REQUIRED", reason: "planning_sessions_invalid",
      });
    }
  });
  it("refuses a second review or a second repair for the planning wave", () => {
    assert.deepEqual(evaluatePlanningReview(review({ round_number: 2, completed_rounds: 2 })), {
      outcome: "HALT", reason: "review_round_limit",
    });
    assert.deepEqual(evaluatePlanningReview(review({ aggregated_repairs: 2 })), {
      outcome: "HALT", reason: "aggregated_repair_limit",
    });
    assert.deepEqual(evaluatePlanningReview(review({ review_after_repair: true })), {
      outcome: "OWNER_AMENDMENT_REQUIRED", reason: "automatic_rereview_prohibited",
    });
  });

  it("draft freeze renders before review; the final freeze needs the completed wave receipt", () => {
    const { dir } = planPackage((doc) => {
      doc.journey_settings.planning_wave = { required_sessions: planningSessions().required_sessions };
    });
    assert.deepEqual(freeze(dir, { stage: "draft" }).findings, []);
    const draftCli = spawnSync(process.execPath, [PLAN_PACKAGE, "draft", dir], { encoding: "utf8" });
    assert.equal(draftCli.status, 0, draftCli.stdout);
    const finalCli = spawnSync(process.execPath, [PLAN_PACKAGE, dir], { encoding: "utf8" });
    assert.equal(finalCli.status, 1);
    assert.ok(JSON.parse(finalCli.stdout).findings.some((f) => f.code === "planning_wave_sessions_incomplete"));
  });
  const receiptCases = [
    ["no wave", (doc) => { delete doc.journey_settings.planning_wave; }, "planning_wave_missing"],
    ["an outstanding session", (doc) => { doc.journey_settings.planning_wave.sessions.pop(); }, "planning_wave_sessions_incomplete"],
    ["no review", (doc) => { doc.journey_settings.planning_wave.reviews = 0; }, "planning_wave_review_count"],
    ["a second review", (doc) => { doc.journey_settings.planning_wave.reviews = 2; }, "planning_wave_review_count"],
    ["a second repair", (doc) => { doc.journey_settings.planning_wave.repairs = 2; }, "planning_wave_repair_limit"],
    ["no deterministic closure", (doc) => { delete doc.journey_settings.planning_wave.closure; }, "planning_wave_closure_missing"],
    ["a stale closing candidate", (doc) => { doc.journey_settings.planning_wave.candidate_digest = "0".repeat(64); }, "planning_wave_candidate_mismatch"],
    ["an unknown session", (doc) => { doc.journey_settings.planning_wave.required_sessions.push("coordinator"); }, "planning_sessions_invalid"],
  ];
  for (const [name, mutate, code] of receiptCases) {
    it(`final freeze refuses ${name}`, () => {
      const result = freeze(planPackage(mutate).dir);
      assert.equal(result.outcome, "FAIL");
      assert.ok(codes(result).includes(code), JSON.stringify(result.findings));
    });
  }
  it("final freeze accepts one review with one repair bound to the repaired candidate", () => {
    const { dir } = planPackage((doc, digest, dir) => {
      doc.journey_settings.planning_wave = planningWave(digest, { repairs: 1 }, dir);
    });
    assert.deepEqual(freeze(dir).findings, []);
  });
});

describe("F2: optional specialists and owner-requested planning review", () => {
  const unreviewed = (names, extra) => (doc, digest) => {
    doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, names, extra);
  };

  it("accepts any subset of enabled specialists, including none, without a review the owner did not request", () => {
    for (const names of [[], ["integration_test"], ["mbse"], ["mbse", "integration_test"]]) {
      const result = freeze(planPackage(unreviewed(names)).dir);
      assert.deepEqual(result.findings, [], JSON.stringify(names));
    }
  });

  it("opens a requested review with only the declared optional sessions", () => {
    const MANIFEST = temp("planning-wave-optional-");
    writeFileSync(path.join(MANIFEST, "plan-dod-manifest.html"), "<!doctype html><title>DoD</title>");
    const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: "d1" };
    for (const names of [[], ["mbse"]]) {
      const result = evaluatePlanningReview({
        candidate, plan_dir: MANIFEST, dod_manifest: { output_name: "plan-dod-manifest.html" },
        planning_wave: planningSessions(candidate, names),
        reviewer_slots: [{ slot_id: "a", primary_route_ref: "r", fallback_route_refs: [] }],
        round_number: 1, completed_rounds: 0,
      });
      assert.deepEqual(result, { outcome: "NEEDS_MORE_EVIDENCE", reason: "review_round_pending" }, JSON.stringify(names));
    }
  });

  const failClosed = [
    ["a declared session that did not return", unreviewed(["mbse", "integration_test"], { sessions: [] }), "planning_wave_sessions_incomplete"],
    ["a declared session still pending", (doc, digest) => {
      unreviewed(["integration_test"])(doc, digest);
      doc.journey_settings.planning_wave.sessions[0].verdict = "WAITING_ON";
    }, "planning_wave_sessions_incomplete"],
    ["a session bound to a stale candidate", (doc, digest) => {
      unreviewed(["integration_test"])(doc, digest);
      doc.journey_settings.planning_wave.sessions[0].candidate_revision = "older";
    }, "planning_wave_sessions_incomplete"],
    ["a forged review count", unreviewed([], { reviews: 1 }), "planning_wave_review_count"],
    ["a forged review receipt", unreviewed([], { review_receipt: { path: "gate-evidence/planning-review.json", sha256: "0".repeat(64) } }), "planning_wave_review_invalid"],
    ["a repair without a review", unreviewed([], { repairs: 1 }), "planning_wave_repair_limit"],
    ["no deterministic closure", unreviewed([], { closure: undefined }), "planning_wave_closure_missing"],
    ["a stale closing candidate", unreviewed([], { candidate_digest: "0".repeat(64) }), "planning_wave_candidate_mismatch"],
    ["a non-boolean review choice", unreviewed([], { review_requested: "no" }), "planning_wave_review_request_invalid"],
    ["a retired design session", unreviewed(["planning_and_design"]), "planning_sessions_invalid"],
    ["requested review without its receipt", (doc, digest) => {
      unreviewed([])(doc, digest);
      doc.journey_settings.planning_wave.review_requested = true;
    }, "planning_wave_review_invalid"],
    ["an unrecorded review choice without a receipt", (doc, digest) => {
      unreviewed([])(doc, digest);
      delete doc.journey_settings.planning_wave.review_requested;
    }, "planning_wave_review_invalid"],
  ];
  for (const [name, mutate, code] of failClosed) {
    it(`final freeze still fails closed on ${name}`, () => {
      const result = freeze(planPackage(mutate).dir);
      assert.equal(result.outcome, "FAIL");
      assert.ok(codes(result).includes(code), JSON.stringify(result.findings));
    });
  }

  it("missing required artifacts still fail the unreviewed freeze", () => {
    const { dir } = planPackage(unreviewed([]));
    rmSync(path.join(dir, "seit.json"));
    assert.equal(freeze(dir).outcome, "FAIL");
    const boundary = planPackage((doc, digest) => { unreviewed([])(doc, digest); delete doc.boundary_contract; });
    assert.ok(codes(freeze(boundary.dir)).includes("boundary_contract_missing"));
  });
});

describe("#204 one requires_regate round", () => {
  const fixture = () => JSON.parse(read("test/fixtures/correction-delta/round.json"));
  const mixed = (correction_rounds) => {
    const input = fixture();
    input.after[1].text = "The receipt includes a unique identifier.";
    input.findings.push({ uid: "REQ-2", finding_type: "requires_regate" });
    return { ...input, correction_rounds };
  };
  it("spends the one round, then a further requires_regate finding returns NEEDS_OWNER_DECISION", () => {
    const first = evaluateCorrectionDelta(mixed(0));
    assert.equal(first.verdict, "REQUIRES_REGATE");
    assert.equal(first.correction_rounds, 1);
    const second = evaluateCorrectionDelta(mixed(first.correction_rounds));
    assert.equal(second.verdict, "NEEDS_OWNER_DECISION");
    assert.equal(second.correction_rounds, 1);
    assert.deepEqual(second.closed_uids, ["REQ-1"]);
    assert.deepEqual(second.regate_uids, ["REQ-2"]);
  });
  it("an exact_text-only follow-up closes mechanically at the spent bound", () => {
    const result = evaluateCorrectionDelta({ ...fixture(), correction_rounds: 1 });
    assert.equal(result.verdict, "DELTA_APPLIED");
    assert.equal(result.correction_rounds, 1);
    assert.deepEqual(result.closed_uids, ["REQ-1"]);
  });
  it("rejects a recorded count beyond one round", () => {
    const result = evaluateCorrectionDelta(mixed(2));
    assert.equal(result.verdict, "VALIDATION_FAILED");
    assert.deepEqual(result.findings, [{ code: "invalid_context" }]);
  });
});

describe("#155 Planning Integration Engineer Boundary/Data-Flow Contract", () => {
  const flow = {
    id: "FLOW-1",
    source: { component: "webhook receiver", owner: "api" },
    sink: { component: "orders table", owner: "storage" },
    path: ["receiver", "queue", "worker", "orders table"],
    transformations: ["JSON parse", "schema validation", "row mapping"],
    side_effects: ["order row insert", "audit event"],
    authority: "schemas/order-event.schema.json",
    evidence: "observed",
    failure_recovery: ["invalid payload -> 400 and no enqueue", "worker crash -> redelivery, idempotent insert"],
    seit_rows: ["SEIT-FLOW-1"],
  };
  const machine = {
    id: "STATE-1",
    component: "session handshake",
    transitions: [
      { from: "IDLE", event: "hello", to: "NEGOTIATING", output: "offer" },
      { from: "NEGOTIATING", event: "accept", to: "OPEN", output: "ack" },
    ],
    illegal_transitions: [{ from: "IDLE", event: "data", handling: "reject with protocol_error; stay IDLE" }],
    ordering: ["hello before data"],
    model: "MODEL-HANDSHAKE",
    seit_rows: ["SEIT-STATE-1"],
  };
  const trust = {
    id: "TRUST-1",
    crossing: "public network -> internal worker",
    enforcement: "HMAC signature verified at the receiver before enqueue",
    seit_rows: ["SEIT-TRUST-1"],
  };
  const withContract = (boundary_contract) => planPackage((doc) => { doc.boundary_contract = boundary_contract; }).dir;

  it("accepts a cross-component data path, a stateful protocol, a trust boundary, and a justified N/A", () => {
    for (const contract of [
      { flows: [flow] },
      { state_machines: [machine] },
      { trust_boundaries: [trust] },
      { flows: [flow], state_machines: [machine], trust_boundaries: [trust], gaps: [{ id: "GAP-1", status: "resolved" }] },
      { not_applicable: true, reason: "Documentation-only change; no component interaction." },
    ]) {
      assert.deepEqual(freeze(withContract(contract)).findings, [], JSON.stringify(contract));
    }
  });
  const negative = [
    ["a missing contract", undefined, "boundary_contract_missing"],
    ["an N/A without rationale", { not_applicable: true, reason: " " }, "boundary_na_reason_missing"],
    ["an empty contract", { flows: [] }, "boundary_contract_empty"],
    ["an unowned sink", { flows: [{ ...flow, sink: { component: "orders table" } }] }, "boundary_flow_endpoint_missing"],
    ["no failure path", { flows: [{ ...flow, failure_recovery: [] }] }, "boundary_flow_failure_missing"],
    ["no contract authority", { flows: [{ ...flow, authority: "" }] }, "boundary_flow_authority_missing"],
    ["unlabelled evidence", { flows: [{ ...flow, evidence: "assumed" }] }, "boundary_flow_evidence_invalid"],
    ["no transformations list", { flows: [{ ...flow, transformations: undefined }] }, "boundary_flow_field_missing"],
    ["an unverified flow", { flows: [{ ...flow, seit_rows: [] }] }, "boundary_unverified"],
    ["a dangling SEIT row", { flows: [{ ...flow, seit_rows: ["SEIT-NOPE"] }] }, "boundary_seit_row_unresolved"],
    ["no illegal transitions", { state_machines: [{ ...machine, illegal_transitions: [] }] }, "boundary_state_illegal_missing"],
    ["no model binding", { state_machines: [{ ...machine, model: undefined }] }, "boundary_state_model_unbound"],
    ["an unnamed enforcement point", { trust_boundaries: [{ ...trust, enforcement: "" }] }, "boundary_trust_enforcement_missing"],
    ["an unresolved material gap", { flows: [flow], gaps: [{ id: "GAP-2", status: "open" }] }, "boundary_gap_unresolved"],
  ];
  for (const [name, contract, code] of negative) {
    it(`blocks the freeze, and so implementation dispatch, on ${name}`, () => {
      const result = freeze(withContract(contract));
      assert.equal(result.outcome, "FAIL");
      assert.ok(codes(result).includes(code), JSON.stringify(result.findings));
    });
  }
});

describe("#157 DoD Manifest shows the per-unit round plan", () => {
  it("renders one row per declared unit, planning included", () => {
    const { html } = renderDodManifest({
      journey_settings: { review_rounds: reviewRounds(["W1"], "wave") },
      dod_manifest: { template_version: TEMPLATE_VERSION, output_name: "x-dod-manifest.html", title: "Rounds" },
    });
    assert.match(html, /Review rounds per declared unit/);
    for (const unit of ["planning", "W1"]) assert.match(html, new RegExp(`<th scope="row" class="id">${unit}</th>`));
    assert.match(html, /deterministic_PASS/);
  });
});

describe("skills declare the planning wave without a mid-wave Requirements Engineer gate", () => {
  const router = read("skills/bearing-lite/SKILL.md");
  const mbse = read("skills/mbse/SKILL.md");
  const allocation = read("skills/planning-and-design/references/allocation-inputs.md");
  const planning = read("skills/planning-and-design/SKILL.md");
  const loop = read("skills/planning-and-design/references/correction-loop.md");
  const wave = read("skills/bearing-lite/references/planning-assembly.md");
  const itSkill = read("skills/integration-test/SKILL.md");
  const ie = read("skills/integration-engineer/SKILL.md");
  const boundary = read("skills/integration-test/references/boundary-contract.md");

  it("removes the mid-wave gate wording and ordering", () => {
    assert.equal(existsSync(path.join(ROOT, "skills/plan-integrator")), false, "Plan Integrator is retired");
    assert.doesNotMatch(wave, /after the Requirements Engineer passes/);
    assert.doesNotMatch(router, /before every Requirements Engineer dispatch/);
    assert.doesNotMatch(mbse, /quality gate after Scope Definition|before the Systems Modeler finalizes/);
    assert.doesNotMatch(mbse, /until the Requirements Engineer passes|after the Requirements Engineer passes/);
    assert.doesNotMatch(allocation, /after the Requirements Engineer passes/);
    assert.doesNotMatch(planning, /two evidence-changing correction rounds|third re-gate/);
    assert.doesNotMatch(mbse, /first two correction rounds|third re-gate/);
  });
  it("declares planning as a wave with the implementation-wave budget", () => {
    assert.match(wave, /planning wave/i);
    assert.match(wave, /cadence: phase/);
    assert.match(wave, /max_assurance_rounds/);
    assert.match(wave, /plan-package\.cjs draft/);
    assert.match(wave, /register-precheck\.cjs/);
    assert.match(wave, /coverage_assist/);
    assert.match(loop, /integer 0–1/);
  });
  it("assigns boundary completeness to Integration and Test planning", () => {
    assert.match(itSkill, /references\/boundary-contract\.md/);
    for (const term of [/source and sink/, /illegal transitions/, /trust boundar/, /authority/, /MBSE/, /not-applicable/, /sixth/]) {
      assert.match(boundary, term);
    }
    assert.match(ie, /independent/);
  });
});

describe("B30-525 planning inputs stay out of the end-review repair (DEC-33)", () => {
  const assembly = read("skills/bearing-lite/references/planning-assembly.md");
  const loop = read("skills/planning-and-design/references/correction-loop.md");
  const rule = assembly.slice(
    assembly.indexOf("### Author-known deltas"),
    assembly.indexOf("## Efficient task planning"),
  );
  const opening = loop.slice(0, loop.indexOf("\n1. "));

  it("consumes a specialist finding and owner-added scope before assembly and spends the one repair only on the end review", () => {
    assert.match(rule, /specialist finding on another author's artifact/);
    assert.match(rule, /owner-added scope/);
    assert.match(rule, /planning inputs/);
    assert.match(rule, /consumes them before assembly/);
    assert.match(rule, /start no review round/);
    assert.match(rule, /repair allowance stays 1/);
    assert.match(rule, /single end-of-planning review/);
    assert.doesNotMatch(rule, /`requires_regate` and follows the correction loop/);
    assert.match(opening, /only for the one repair of findings from the single\s+end-of-planning review/);
    assert.match(opening, /owner-added scope/);
    assert.match(opening, /planning inputs/);
    assert.match(opening, /planning-assembly\.md#author-known-deltas-221/);

    const { dir } = planPackage((doc, digest) => {
      doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["integration_test"]);
    });
    assert.deepEqual(freeze(dir).findings, []);
    const wave = JSON.parse(readFileSync(path.join(dir, "implementation.json"), "utf8")).journey_settings.planning_wave;
    assert.equal(wave.reviews, 0);
    assert.equal(wave.repairs, 0);

    const endReview = (correction_rounds) => {
      const input = JSON.parse(read("test/fixtures/correction-delta/round.json"));
      input.after[1].text = "The receipt includes a unique identifier.";
      input.findings.push({ uid: "REQ-2", finding_type: "requires_regate" });
      return { ...input, correction_rounds };
    };
    const first = evaluateCorrectionDelta(endReview(0));
    assert.equal(first.verdict, "REQUIRES_REGATE");
    assert.equal(first.correction_rounds, 1);
    const second = evaluateCorrectionDelta(endReview(first.correction_rounds));
    assert.equal(second.verdict, "NEEDS_OWNER_DECISION");
    assert.equal(second.correction_rounds, 1);
  });
});

describe("Alphazedehq#581 planning process rules", () => {
  const assembly = read("skills/bearing-lite/references/planning-assembly.md").replace(/\s+/g, " ");
  const pd = read("skills/planning-and-design/SKILL.md").replace(/\s+/g, " ");
  const alloc = read("skills/planning-and-design/references/allocation-inputs.md").replace(/\s+/g, " ");
  const grammar = read("skills/planning-and-design/references/artifact-grammar.md").replace(/\s+/g, " ");
  const router = read("skills/bearing-lite/SKILL.md").replace(/\s+/g, " ");
  const ownerStops = read("skills/bearing-lite/references/owner-stops.md").replace(/\s+/g, " ");

  it("enforces mechanical ID/hash fix edit record, zero author-known relaunches, and meaning changes to author", () => {
    for (const [name, text] of [["planning-assembly", assembly], ["planning-and-design", pd]]) {
      assert.match(text, /purely mechanical ID and hash binding fixes/i, name);
      assert.match(text, /edit record/i, name);
      assert.match(text, /change of meaning returns to the owning (?:author|specialist)/i, name);
      assert.match(text, /zero.*relaunch/i, name);
    }
  });

  it("freezes requirement skeleton (UIDs and titles) and decisions at dispatch for parallel mbse and integration_test", () => {
    for (const [name, text] of [["planning-assembly", assembly], ["planning-and-design", pd], ["allocation-inputs", alloc]]) {
      assert.match(text, /requirement skeleton \(UIDs and titles\)/, name);
      assert.match(text, /mbse[\s\S]{0,80}integration_test[\s\S]{0,80}in parallel/i, name);
      assert.match(text, /waits for assembly/i, name);
    }
    assert.match(assembly, /freeze the \*\*requirement skeleton \(UIDs and titles\)\*\* and \*\*active decisions\*\*/);
  });

  it("requires one plan per phase and owner question box on scope cuts dropping acceptance items even under delegation", () => {
    for (const [name, text] of [["planning-assembly", assembly], ["planning-and-design", pd], ["artifact-grammar", grammar]]) {
      assert.match(text, /one plan per phase/i, name);
    }
    for (const [name, text] of [["bearing-lite", router], ["owner-stops", ownerStops], ["planning-and-design", pd]]) {
      assert.match(text, /drops an acceptance item[\s\S]{0,80}owner question box[\s\S]{0,80}even under delegation/i, name);
    }
  });
});

describe("Alphazedehq#583 planning speed rules", () => {
  const prompt = read("skills/prompt/SKILL.md").replace(/\s+/g, " ");
  const roleLoops = read("skills/prompt/references/role-loops.md").replace(/\s+/g, " ");
  const instrClasses = read("skills/prompt/references/instruction-classes.md").replace(/\s+/g, " ");
  const router = read("skills/bearing-lite/SKILL.md").replace(/\s+/g, " ");
  const assembly = read("skills/bearing-lite/references/planning-assembly.md").replace(/\s+/g, " ");
  const taskState = read("skills/bearing-lite/references/task-state.md").replace(/\s+/g, " ");
  const prePacket = read("skills/bearing-lite/references/pre-packet.md").replace(/\s+/g, " ");
  const taskTpl = read("skills/bearing-lite/templates/task.md").replace(/\s+/g, " ");
  const pd = read("skills/planning-and-design/SKILL.md").replace(/\s+/g, " ");
  const grammar = read("skills/planning-and-design/references/artifact-grammar.md").replace(/\s+/g, " ");
  const align = read("skills/architectural-alignment/SKILL.md").replace(/\s+/g, " ");
  const workspaceTpl = read("skills/architectural-alignment/templates/workspace.md").replace(/\s+/g, " ");
  const mbse = read("skills/mbse/SKILL.md").replace(/\s+/g, " ");
  const mbsePrecheck = read("skills/mbse/references/precheck.md").replace(/\s+/g, " ");
  const mbseReport = read("skills/mbse/references/gate-report.md").replace(/\s+/g, " ");
  const itSkill = read("skills/integration-test/SKILL.md").replace(/\s+/g, " ");
  const teSkill = read("skills/test-engineer/SKILL.md").replace(/\s+/g, " ");
  const ieSkill = read("skills/integration-engineer/SKILL.md").replace(/\s+/g, " ");

  it("(1) runs repository gate once at assembly while planning specialists run only their own artifact checker", () => {
    for (const [name, text] of [
      ["prompt", prompt],
      ["role-loops", roleLoops],
      ["instruction-classes", instrClasses],
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task-state", taskState],
      ["pre-packet", prePacket],
      ["task.md", taskTpl],
      ["planning-and-design", pd],
    ]) {
      assert.match(text, /repository gate runs once at assembly|run the repository gate once at assembly|repository gate runs once/i, name);
      assert.match(text, /only (?:its|their|that specialist's) own artifact checker/i, name);
    }
    for (const [name, text] of [
      ["mbse", mbse],
      ["mbse/precheck", mbsePrecheck],
      ["integration-test", itSkill],
    ]) {
      assert.match(text, /only (?:your|its) own artifact checker/i, name);
      assert.match(text, /repository gate[\s\S]{0,60}once at assembly/i, name);
    }
  });

  it("(2) requires evidence returns to report digests, commands, and exit codes rather than narrative logs", () => {
    for (const [name, text] of [
      ["prompt", prompt],
      ["role-loops", roleLoops],
      ["instruction-classes", instrClasses],
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task-state", taskState],
      ["pre-packet", prePacket],
      ["task.md", taskTpl],
      ["planning-and-design", pd],
      ["artifact-grammar", grammar],
      ["mbse", mbse],
      ["mbse/precheck", mbsePrecheck],
      ["mbse/gate-report", mbseReport],
      ["integration-test", itSkill],
      ["test-engineer", teSkill],
      ["integration-engineer", ieSkill],
    ]) {
      assert.match(text, /digests?, commands?, and exit codes/i, name);
      assert.match(text, /not narrative logs|rather than narrative logs/i, name);
    }
  });

  it("(4) defines light (orchestrator plus one author), standard, and full process tiers chosen by a stated risk rule", () => {
    assert.match(assembly, /## Process tiers and stated risk rule/);
    for (const [name, text] of [
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task-state", taskState],
      ["task.md", taskTpl],
      ["architectural-alignment", align],
      ["planning-and-design", pd],
      ["artifact-grammar", grammar],
    ]) {
      assert.match(text, /light[^.]{0,60}Orchestrator plus one author/i, name);
      assert.match(text, /\bstandard\b/i, name);
      assert.match(text, /\bfull\b/i, name);
    }
    for (const [name, text] of [
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task.md", taskTpl],
      ["architectural-alignment", align],
      ["artifact-grammar", grammar],
    ]) {
      assert.match(text, /stated risk rule/i, name);
    }
    assert.match(workspaceTpl, /Process tier:\s*`?<light \| standard \| full>`?/);
  });

  it("(5) requires every packet to carry a time target and the limit-return gap rule", () => {
    for (const [name, text] of [
      ["prompt", prompt],
      ["role-loops", roleLoops],
      ["instruction-classes", instrClasses],
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task-state", taskState],
      ["pre-packet", prePacket],
      ["task.md", taskTpl],
      ["planning-and-design", pd],
      ["mbse", mbse],
      ["mbse/gate-report", mbseReport],
      ["integration-test", itSkill],
      ["test-engineer", teSkill],
      ["integration-engineer", ieSkill],
    ]) {
      assert.match(text, /time target/i, name);
      assert.match(text, /at the limit, return what you have and list the gaps/i, name);
    }
  });

  it("(7) requires Alignment to reuse the previous repository-map.md after a freshness check", () => {
    for (const [name, text] of [
      ["bearing-lite", router],
      ["planning-assembly", assembly],
      ["task-state", taskState],
      ["architectural-alignment", align],
      ["workspace.md", workspaceTpl],
    ]) {
      assert.match(text, /reus(?:e|ing) the previous `repository-map\.md`/i, name);
      assert.match(text, /freshness/i, name);
    }
  });
});

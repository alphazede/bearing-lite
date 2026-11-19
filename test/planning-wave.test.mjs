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
const closeout = require(path.join(ROOT, "hooks/closeout.cjs"));
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

  it("accepts the produced final freeze receipt for handoff and refuses the produced draft receipt", () => {
    const { dir, digest } = planPackage();
    for (const [args, expected] of [[[dir], "ADVISE"], [["draft", dir], "REROUTE"]]) {
      const cli = spawnSync(process.execPath, [PLAN_PACKAGE, ...args], { encoding: "utf8" });
      assert.equal(cli.status, 0, cli.stdout || cli.stderr);
      const receipt = JSON.parse(cli.stdout);
      assert.equal(receipt.manifest_digest, digest);
      const result = closeout.evaluate({ mode: "handoff", final_freeze_receipt: receipt });
      assert.equal(result.outcome, expected, result.reason);
    }
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
  it("uses a recorded closing return at the planning review transition", () => {
    const planning_review = review();
    const author = planning_review.planning_wave.sessions[0];
    author.verdict = "GAPS";
    author.closing_return = {
      author: author.session, reason: "gaps", items: ["Missing requirement link"],
      candidate, verdict: "READY",
    };
    const result = transition.evaluate({ action_kind: "planning_review_transition", planning_review });
    assert.equal(result.reason, "planning_review:PASS");
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

describe("Alphazedehq#593 one closing return for GAPS", () => {
  it("documents who authorizes a closing return, that it resumes the author's session, and is not a relaunch", () => {
    const assembly = read("skills/bearing-lite/references/planning-assembly.md").replace(/\s+/g, " ");
    assert.match(assembly, /one closing return/i);
    assert.match(assembly, /Planning Orchestrator[^.]{0,120}(?:authorize|resume)[^.]{0,120}(?:author's own session|own session)/i);
    assert.match(assembly, /(?:not a relaunch|does not count as a relaunch|outside the zero author-known relaunch budget)/i);
    assert.match(assembly, /recorded[^.]{0,80}author[^.]{0,30}reason[^.]{0,30}items[^.]{0,30}candidate/i);
  });

  it("refuses unclosed GAPS and accepts one recorded closing return closing GAPS to READY at final freeze", () => {
    const unclosed = planPackage((doc, digest) => {
      doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["mbse"]);
      doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
    });
    const unclosedResult = freeze(unclosed.dir);
    assert.equal(unclosedResult.outcome, "FAIL");
    assert.ok(codes(unclosedResult).includes("planning_wave_sessions_incomplete"), JSON.stringify(unclosedResult));

    const closedOnSession = planPackage((doc, digest) => {
      doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["mbse"]);
      const closing = doc.journey_settings.planning_wave.closing_candidate;
      doc.journey_settings.planning_wave.sessions[0] = {
        session: "mbse",
        candidate_ref: "plan",
        candidate_revision: "r0",
        candidate_digest: "1".repeat(64),
        verdict: "GAPS",
        closing_return: {
          author: "mbse",
          reason: "gaps",
          items: ["REQ-1 acceptance criteria"],
          candidate: closing,
          verdict: "READY",
        },
      };
    });
    const cliSession = spawnSync(process.execPath, [PLAN_PACKAGE, closedOnSession.dir], { encoding: "utf8" });
    assert.equal(cliSession.status, 0, cliSession.stdout);
    assert.equal(JSON.parse(cliSession.stdout).outcome, "PASS");

    const closedOnWave = planPackage((doc, digest, dir) => {
      doc.journey_settings.planning_wave = planningWave(digest, {}, dir);
      const closing = doc.journey_settings.planning_wave.closing_candidate;
      doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
      doc.journey_settings.planning_wave.closing_returns = [{
        author: "mbse",
        reason: "gaps",
        items: ["REQ-1 acceptance criteria"],
        candidate: closing,
        verdict: "READY",
      }];
      const reviewPath = path.join(dir, "gate-evidence/planning-review.json");
      const reviewDoc = JSON.parse(readFileSync(reviewPath, "utf8"));
      reviewDoc.planning_wave = {
        required_sessions: doc.journey_settings.planning_wave.required_sessions,
        sessions: structuredClone(doc.journey_settings.planning_wave.sessions),
        closing_returns: structuredClone(doc.journey_settings.planning_wave.closing_returns),
      };
      const reviewBytes = JSON.stringify(reviewDoc);
      writeFileSync(reviewPath, reviewBytes);
      doc.journey_settings.planning_wave.review_receipt.sha256 = sha(reviewBytes);
    });
    const cliWave = spawnSync(process.execPath, [PLAN_PACKAGE, closedOnWave.dir], { encoding: "utf8" });
    assert.equal(cliWave.status, 0, cliWave.stdout);
    assert.equal(JSON.parse(cliWave.stdout).outcome, "PASS");
  });

  it("refuses a second closing return or an incomplete/unready closing return", () => {
    const cases = [
      ["a second closing return on the same author", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
        doc.journey_settings.planning_wave.sessions[0].closing_return = {
          author: "mbse", reason: "gaps", items: ["gap-1"], candidate: closing, verdict: "READY",
        };
        doc.journey_settings.planning_wave.closing_returns = [{
          author: "mbse", reason: "gaps", items: ["gap-2"], candidate: closing, verdict: "READY",
        }];
      }],
      ["two entries for one author in closing_returns", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
        doc.journey_settings.planning_wave.closing_returns = [
          { author: "mbse", reason: "gaps", items: ["gap-1"], candidate: closing, verdict: "READY" },
          { author: "mbse", reason: "gaps", items: ["gap-2"], candidate: closing, verdict: "READY" },
        ];
      }],
      ["missing items on closing_return", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
        doc.journey_settings.planning_wave.sessions[0].closing_return = {
          author: "mbse", reason: "gaps", items: [], candidate: closing, verdict: "READY",
        };
      }],
      ["unready closing_return verdict", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
        doc.journey_settings.planning_wave.sessions[0].closing_return = {
          author: "mbse", reason: "gaps", items: ["gap-1"], candidate: closing, verdict: "GAPS",
        };
      }],
      ["stale closing_return candidate", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "GAPS";
        doc.journey_settings.planning_wave.sessions[0].closing_return = {
          author: "mbse", reason: "gaps", items: ["gap-1"], candidate: { ...closing, candidate_revision: "stale" }, verdict: "READY",
        };
      }],
      ["closing_return on a WAITING_ON session", (doc) => {
        const closing = doc.journey_settings.planning_wave.closing_candidate;
        doc.journey_settings.planning_wave.sessions[0].verdict = "WAITING_ON";
        doc.journey_settings.planning_wave.sessions[0].closing_return = {
          author: "mbse", reason: "gaps", items: ["gap-1"], candidate: closing, verdict: "READY",
        };
      }],
    ];
    for (const [label, mutate] of cases) {
      const pkg = planPackage((doc, digest) => {
        doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["mbse"]);
        mutate(doc);
      });
      const result = freeze(pkg.dir);
      assert.equal(result.outcome, "FAIL", label);
      assert.ok(codes(result).includes("planning_wave_sessions_incomplete"), `${label}: ${JSON.stringify(result)}`);
    }
  });
});

describe("Alphazedehq#595 meaning defect at assembly uses one closing return", () => {
  for (const [label, verdict, adoptClosingReturn, expected] of [
      ["no closing verdict", undefined, true, "FAIL"],
      ["original adoption only", "READY", false, "FAIL"],
      ["closing return adoption", "READY", true, "PASS"],
  ]) {
    it(`checks the closing return's own verdict and adoption evidence: ${label}`, () => {
      const pkg = planPackage((doc, digest) => {
        const wave = unreviewedPlanningWave(digest, ["integration_test"]);
        const earlier = { candidate_ref: "plan", candidate_revision: "r0", candidate_digest: "2".repeat(64) };
        const adoption = {
          adopted_to: wave.closing_candidate,
          inputs: [{ path: "plan.md", sha256: sha("# Plan\n") }],
        };
        wave.sessions[0] = {
          session: "integration_test", verdict: "READY", ...earlier, ...adoption,
          closing_return: {
            author: "integration_test", reason: "meaning_defect", items: ["Check accepts the wrong outcome"],
            candidate: { ...earlier, candidate_revision: "r0-corrected", candidate_digest: "3".repeat(64) },
            verdict, ...(adoptClosingReturn ? adoption : {}),
          },
        };
        doc.journey_settings.planning_wave = wave;
      });
      const result = freeze(pkg.dir);
      assert.equal(result.outcome, expected, `${label}: ${JSON.stringify(result.findings)}`);
    });
  }

  it("names one closing return and its record in both planning-assembly.md and planning-and-design/SKILL.md", () => {
    const assembly = read("skills/bearing-lite/references/planning-assembly.md").replace(/\s+/g, " ");
    const pd = read("skills/planning-and-design/SKILL.md").replace(/\s+/g, " ");
    for (const [name, text] of [["planning-assembly", assembly], ["planning-and-design", pd]]) {
      assert.match(text, /one closing return/i, name);
      assert.match(text, /meaning defect/i, name);
      assert.match(text, /(?:resum(?:e|ing)[^.]{0,80}(?:own )?session|author's own session)/i, name);
      assert.match(text, /(?:not a relaunch|not count(?:ed)? as a relaunch|does not count as a relaunch)/i, name);
      assert.match(text, /author[^.]{0,30}reason[^.]{0,30}items[^.]{0,30}candidate/i, name);
    }
  });

  it("accepts one recorded closing return for a meaning defect found at assembly and refuses a second", () => {
    const pkg = planPackage((doc, digest) => {
      doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["integration_test"]);
      const closing = doc.journey_settings.planning_wave.closing_candidate;
      doc.journey_settings.planning_wave.sessions[0] = {
        session: "integration_test",
        candidate_ref: "plan",
        candidate_revision: "r0",
        candidate_digest: "2".repeat(64),
        verdict: "READY",
        closing_return: {
          author: "integration_test",
          reason: "meaning_defect",
          items: ["CMD-B-SVC-SNAP probed live socket instead of fixture"],
          candidate: closing,
          verdict: "READY",
        },
      };
    });
    assert.deepEqual(freeze(pkg.dir).findings, []);

    const second = planPackage((doc, digest) => {
      doc.journey_settings.planning_wave = unreviewedPlanningWave(digest, ["integration_test"]);
      const closing = doc.journey_settings.planning_wave.closing_candidate;
      doc.journey_settings.planning_wave.closing_returns = [
        { author: "integration_test", reason: "gaps", items: ["gap-1"], candidate: closing, verdict: "READY" },
        { author: "integration_test", reason: "meaning_defect", items: ["fix-2"], candidate: closing, verdict: "READY" },
      ];
    });
    const secondResult = freeze(second.dir);
    assert.equal(secondResult.outcome, "FAIL");
    assert.ok(codes(secondResult).includes("planning_wave_sessions_incomplete"), JSON.stringify(secondResult));
  });
});

describe("Alphazedehq#596 pre-packet and task-state scope handoff compiler to execution packets", () => {
  it("scopes tools/compile-handoff.mjs to execution packets and uses Prompt template for planning (pre-assembly) packets", () => {
    for (const name of ["pre-packet", "task-state"]) {
      const text = read(`skills/bearing-lite/references/${name}.md`).replace(/\s+/g, " ");
      const instructions = text.split(/\. |, and /);
      assert.ok(instructions.some((part) => /\bexecution packets?\b/i.test(part) &&
        /tools\/compile-handoff\.mjs/.test(part)), `${name} directs execution packets to the compiler`);
      assert.ok(instructions.some((part) => /\bplanning(?:\s+\(pre-assembly\))?\s+packets?\b/i.test(part) &&
        /\bPrompt template\b/i.test(part)), `${name} directs planning packets to the Prompt template`);
    }
  });
});

describe("Alphazedehq#600 Implementation Orchestrator links consultation.md and checkpoints", () => {
  it("links references/consultation.md and names all four consultation checkpoints in the Implementation step", () => {
    const router = read("skills/bearing-lite/SKILL.md");
    const implStep = router.slice(
      router.indexOf("4. **Implementation:**"),
      router.indexOf("5. **Review:**"),
    );
    const [, target] = /\[[^\]]+\]\(([^)]+\/consultation\.md)\)/.exec(implStep) ?? [];
    assert.ok(target && existsSync(path.resolve(ROOT, "skills/bearing-lite", target)),
      "The Implementation step links to the Fellow consultation guide");
    assert.match(implStep, /before a major decision/i);
    assert.match(implStep, /stuck after two genuine attempts/i);
    assert.match(implStep, /before declaring a task done/i);
    assert.match(implStep, /when the owner asks/i);
  });
});

describe("Alphazedehq#603 Integration and Test run-once command check", () => {
  it("names the run-once command step and return record in skills/integration-test/SKILL.md", () => {
    const itSkill = read("skills/integration-test/SKILL.md");
    const proc = itSkill.slice(itSkill.indexOf("## Procedure"), itSkill.indexOf("## Return and boundaries")).replace(/\s+/g, " ");
    const ret = itSkill.slice(itSkill.indexOf("## Return and boundaries")).replace(/\s+/g, " ");
    assert.match(proc, /run[^.]*\bonce\b/i);
    assert.match(proc, /reason[^.]*(?:defer|cannot run before implementation)/i);
    assert.match(ret, /run-once|each frozen command/i);
    assert.match(ret, /exit code[^.]*(?:reason[^.]*cannot run|pre-implementation)/i);
  });

  it("defers SEIT command checks outside planning authority or the declared run budget", () => {
    const skill = read("skills/integration-test/SKILL.md");
    const selfCheck = skill.slice(skill.indexOf("**Self-check and deltas"), skill.indexOf("**Plan-package checker rules"));
    assert.match(selfCheck, /planning\s+authority/i);
    assert.match(selfCheck, /another role/i);
    assert.match(selfCheck, /one-run budget/i);
    assert.match(selfCheck, /reason to defer/i);
  });
});

describe("Alphazedehq#605 independent validation of a single-run receipt under one-run budget", () => {
  it("names the form and when it applies in skills/integration-test, skills/test-engineer, and verification.md", () => {
    for (const rel of [
      "skills/integration-test/SKILL.md",
      "skills/test-engineer/SKILL.md",
      "skills/bearing-lite/references/verification.md",
    ]) {
      const text = read(rel).replace(/\s+/g, " ");
      assert.match(text, /independent validation of a single-run receipt/i, rel);
      assert.match(text, /one-run budget/i, rel);
      assert.match(text, /inputs,\s*digest,?\s*and\s*(?:retained\s+)?log/i, rel);
    }
  });

  it("requires the assurance verdict to cite the original run for receipt validation", () => {
    const assurance = read("skills/test-engineer/SKILL.md").replace(/\s+/g, " ");
    assert.match(assurance, /(?:cite|reference|link to) the (?:original|sole) run/i);
    assert.match(assurance, /independent assurance receipt/i);
  });
});

describe("Alphazedehq#608 ready-slice orchestration and planning guidance", () => {
  it("Implementation Orchestrator text starts every ready slice whose inputs and resource are free", () => {
    const router = read("skills/bearing-lite/SKILL.md");
    const implStep = router.slice(
      router.indexOf("4. **Implementation:**"),
      router.indexOf("5. **Review:**"),
    ).replace(/\s+/g, " ");
    assert.match(implStep, /start every (?:ready )?slice/i);
    assert.match(implStep, /inputs/i);
    assert.match(implStep, /resource/i);
    assert.match(implStep, /ready-set\.cjs/);

    const assembly = read("skills/bearing-lite/references/planning-assembly.md").replace(/\s+/g, " ");
    assert.match(assembly, /false_serial_chain|share no input or resource/i);
    assert.match(assembly, /starts every ready slice/i);

    const taskState = read("skills/bearing-lite/references/task-state.md").replace(/\s+/g, " ");
    assert.match(taskState, /start every ready slice/i);

    const pdSkill = read("skills/planning-and-design/SKILL.md").replace(/\s+/g, " ");
    assert.match(pdSkill, /inputs/i);
    assert.match(pdSkill, /resource/i);
  });
});

describe("Alphazedehq#611 copy-only or read-only live-host phase tier rule", () => {
  it("documents the standard-tier before/after live-service observation rule and unchanged delete/mutate rule", () => {
    for (const rel of [
      "skills/bearing-lite/references/planning-assembly.md",
      "skills/bearing-lite/references/verification.md",
    ]) {
      const text = read(rel).replace(/\s+/g, " ");
      assert.match(text, /copy-only or read-only/i, rel);
      assert.match(text, /live services|live-service/i, rel);
      assert.match(text, /\bstandard\b/i, rel);
      assert.match(text, /before and after live-service observation/i, rel);
      assert.match(text, /no separate assurance/i, rel);
      assert.match(text, /deletes? or mutates?/i, rel);
    }
  });
});

describe("Alphazedehq#609 per-phase choice between reviewed command list and reusable tooling", () => {
  it("requires planning text and grammar to decide per phase, record why, and state reuse for new tooling", () => {
    for (const rel of [
      "skills/planning-and-design/SKILL.md",
      "skills/planning-and-design/references/artifact-grammar.md",
      "skills/bearing-lite/references/planning-assembly.md",
    ]) {
      const text = read(rel).replace(/\s+/g, " ");
      assert.match(text, /short reviewed command list/i, rel);
      assert.match(text, /new reusable tooling/i, rel);
      assert.match(text, /record(?:s|ing)? why|reason/i, rel);
      assert.match(text, /states? its reuse|reuse/i, rel);
    }
  });
});

describe("Alphazedehq#610 preflight slice and closing real-gate run", () => {
  it("requires planning and implementation text to run a parallel preflight slice across target hosts and close host-building phases with the repository real gate", () => {
    for (const rel of [
      "skills/planning-and-design/SKILL.md",
      "skills/planning-and-design/references/artifact-grammar.md",
      "skills/integration-test/SKILL.md",
      "skills/bearing-lite/references/planning-assembly.md",
      "skills/bearing-lite/references/task-state.md",
      "skills/bearing-lite/SKILL.md",
    ]) {
      const text = read(rel).replace(/\s+/g, " ");
      assert.match(text, /first implementation slice|preflight/i, rel);
      assert.match(text, /dry-run.*--version|--version.*dry-run/i, rel);
      assert.match(text, /every target host/i, rel);
      assert.match(text, /in parallel/i, rel);
      assert.match(text, /builds? a host/i, rel);
      assert.match(text, /real gate/i, rel);
    }
  });
});

/** F1–F5 accepted repair: real hooks, complete canonical corpus, no engine or model calls. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDodManifest, TEMPLATE_VERSION } from "../tools/render-dod-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { freeze } = require("../hooks/plan-package.cjs");
const { evaluatePlanningReview } = require("../hooks/planning-review.cjs");
const corpus = JSON.parse(readFileSync(new URL("./fixtures/planning-repair-package.json", import.meta.url)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["requirements_engineer", "integration_engineer", "test_engineer"];
const copy = value => structuredClone(value);

function fixture(t, { adoptEarlierInputs = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "planning-repair-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, ".git"), "synthetic repository marker");
  mkdirSync(path.join(dir, "gate-evidence"));
  const doc = copy(corpus.implementation), seit = copy(corpus.seit);
  let plan = "# Reviewed plan\n", notes = "Unrelated draft notes\n";
  function inputs() {
    writeFileSync(path.join(dir, "plan.md"), plan);
    writeFileSync(path.join(dir, "notes.md"), notes);
    seit.source_baseline.planning_inputs = [{ path: "plan.md", sha256: sha(plan) }, { path: "notes.md", sha256: sha(notes) }];
    const bytes = JSON.stringify(seit);
    writeFileSync(path.join(dir, "seit.json"), bytes);
    return [...seit.source_baseline.planning_inputs, { path: "seit.json", sha256: sha(bytes) }];
  }
  const priorInputs = inputs();
  const priorCandidate = { candidate_ref: "plan", candidate_revision: "r0", candidate_digest: sha(priorInputs.map(x => x.sha256).join("\n")) };
  // Before the first review, only unconsumed notes change after the source return.
  if (adoptEarlierInputs) notes += "Updated notes outside this specialist's inputs.\n";
  const input_digests = inputs();
  const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: sha(input_digests.map(x => x.sha256).join("\n")) };
  const sessions = names.map(session => ({ session, ...candidate, verdict: "READY", inputs: [copy(input_digests[0])] }));
  if (adoptEarlierInputs) Object.assign(sessions[0], priorCandidate, { inputs: [copy(priorInputs[0])], adopted_to: copy(candidate) });
  const review = {
    candidate: copy(candidate), input_digests,
    planning_wave: { required_sessions: names, sessions: copy(sessions) },
    dod_manifest: { output_name: "review.html" },
    reviewer_slots: [{ slot_id: "one", primary_route_ref: "independent-route", fallback_route_refs: [] }],
    round_number: 1, completed_rounds: 1,
    receipts: [{ slot_id: "one", selected_route_ref: "independent-route", ...candidate, independent: true, findings_isolated: true, verdict: "ACCEPT" }],
    aggregation_complete: true, aggregated_repairs: 0,
  };
  const wave = doc.journey_settings.planning_wave;
  Object.assign(wave, { sessions: copy(sessions), closing_candidate: copy(candidate), candidate_digest: candidate.candidate_digest });
  doc.journey_settings.planning_review = { candidate_digest: candidate.candidate_digest };
  writeFileSync(path.join(dir, "review.html"), renderDodManifest({ dod_manifest: { template_version: TEMPLATE_VERSION, output_name: "review.html", title: "Review evidence" } }).html);
  function saveReview() {
    const bytes = JSON.stringify(review);
    writeFileSync(path.join(dir, "gate-evidence/planning-review.json"), bytes);
    wave.review_receipt = { path: "gate-evidence/planning-review.json", sha256: sha(bytes) };
  }
  saveReview();
  function run(stage = "final") {
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(doc));
    return freeze(dir, { stage });
  }
  return { dir, doc, wave, seit, candidate, review, saveReview, run,
    evaluate: () => evaluatePlanningReview({ ...review, plan_dir: dir }),
    repair() {
      plan += "A repair changes a reviewed input.\n";
      const digests = inputs();
      const closing = { ...candidate, candidate_revision: "r2", candidate_digest: sha(digests.map(x => x.sha256).join("\n")) };
      Object.assign(wave, { repairs: 1, closing_candidate: closing, candidate_digest: closing.candidate_digest,
        repair: { from_candidate: copy(candidate), to_candidate: copy(closing), deterministic_gate: "PASS" } });
      doc.journey_settings.planning_review.candidate_digest = closing.candidate_digest;
      return closing;
    },
  };
}
function rejects(result, code, reason) {
  assert.equal(result.outcome, "FAIL", JSON.stringify(result));
  assert.ok(result.findings.some(f => f.code === code && (!reason || f.reason === reason)), JSON.stringify(result));
}

test("F1 valid completed independent review evidence closes the package", t => {
  const fx = fixture(t);
  assert.equal(fx.evaluate().outcome, "PASS");
  assert.deepEqual(fx.run().findings, []);
});
for (const [name, mutate, reason] of [
  ["missing", fx => { delete fx.wave.review_receipt; }, "receipt_missing"],
  ["pending", fx => { fx.review.completed_rounds = 0; fx.saveReview(); }, "review_round_pending"],
  ["no reviewer receipt", fx => { fx.review.receipts = []; fx.saveReview(); }, "candidate_or_independence_mismatch"],
  ["non-independent", fx => { fx.review.receipts[0].independent = false; fx.saveReview(); }, "candidate_or_independence_mismatch"],
  ["unaggregated", fx => { fx.review.aggregation_complete = false; fx.saveReview(); }, "aggregation_pending"],
  ["pending reviewer return", fx => { fx.review.receipts[0].verdict = "WAITING_ON"; fx.saveReview(); }, "reviewer_receipt_pending"],
  ["hash changed", fx => { fx.wave.review_receipt.sha256 = "0".repeat(64); }, "receipt_digest_mismatch"],
]) test(`F1 ${name} review evidence cannot be replaced by completed counters`, t => {
  const fx = fixture(t); mutate(fx);
  rejects(fx.run(), "planning_wave_review_invalid", reason);
});

test("F1 a repair-required independent verdict cannot close with zero repairs", t => {
  const fx = fixture(t);
  fx.review.receipts[0].verdict = "REPAIR_REQUIRED"; fx.saveReview();
  rejects(fx.run(), "planning_wave_repair_lineage_invalid");
  fx.repair(); assert.deepEqual(fx.run().findings, []);
});
for (const kind of ["absolute", "symlink"]) test(`F1 ${kind} receipt cannot escape the plan directory`, t => {
  const fx = fixture(t), outside = fixture(t);
  const outsideFile = path.join(outside.dir, outside.wave.review_receipt.path);
  if (kind === "absolute") fx.wave.review_receipt.path = outsideFile;
  else {
    symlinkSync(outsideFile, path.join(fx.dir, "linked-review.json"));
    fx.wave.review_receipt.path = "linked-review.json";
  }
  rejects(fx.run(), "planning_wave_review_invalid", "receipt_path_invalid");
});

test("F1/F2 changed-input repair closes without replacing independent review or specialist provenance", t => {
  const fx = fixture(t), before = JSON.stringify(fx.review), originalSessions = copy(fx.wave.sessions);
  const bytes = readFileSync(path.join(fx.dir, fx.wave.review_receipt.path));
  const closing = fx.repair();
  assert.notEqual(closing.candidate_digest, fx.candidate.candidate_digest);
  assert.deepEqual(fx.run().findings, []);
  assert.equal(JSON.stringify(fx.review), before);
  assert.deepEqual(fx.wave.sessions, originalSessions);
  assert.deepEqual(readFileSync(path.join(fx.dir, fx.wave.review_receipt.path)), bytes);
  fx.wave.repair.from_candidate.candidate_digest = "0".repeat(64);
  rejects(fx.run(), "planning_wave_repair_lineage_invalid");
});
for (const field of ["candidate_revision", "candidate_digest"]) test(`F2 stale ${field} under the same ref cannot open review`, t => {
  const fx = fixture(t); fx.review.planning_wave.sessions[0][field] = "stale";
  assert.deepEqual(fx.evaluate(), { outcome: "NEEDS_MORE_EVIDENCE", reason: "planning_sessions_incomplete" });
});
test("F2 unrelated equal session refs cannot satisfy final freeze", t => {
  const fx = fixture(t); fx.wave.sessions.forEach(s => { s.candidate_ref = "unrelated-plan"; });
  rejects(fx.run(), "planning_wave_session_provenance_mismatch");
});
test("F2 changed closing identity requires the single explicit repair lineage", t => {
  const fx = fixture(t); fx.repair(); delete fx.wave.repair;
  rejects(fx.run(), "planning_wave_repair_lineage_invalid");
});
test("F2 unchanged-input adoption retains source identities and resolves target-bound digests", t => {
  const fx = fixture(t, { adoptEarlierInputs: true });
  const s = fx.review.planning_wave.sessions[0];
  assert.notEqual(s.candidate_digest, fx.candidate.candidate_digest);
  assert.equal(fx.evaluate().outcome, "PASS");
  fx.wave.sessions = copy(fx.review.planning_wave.sessions); fx.saveReview();
  assert.deepEqual(fx.run().findings, []);
  // The later authorized repair may change consumed inputs without renewing review.
  fx.repair(); assert.deepEqual(fx.run().findings, []);
  s.inputs[0].sha256 = "0".repeat(64);
  assert.equal(fx.evaluate().reason, "planning_sessions_incomplete");
});
test("F2 unresolved or forged target input snapshots cannot justify adoption", t => {
  const fx = fixture(t), s = fx.review.planning_wave.sessions[0];
  s.candidate_revision = "prior-draft"; s.adopted_to = copy(fx.candidate);
  s.inputs[0].path = "missing-input.md";
  assert.equal(fx.evaluate().reason, "planning_sessions_incomplete");
  s.inputs[0] = copy(fx.review.input_digests[0]);
  fx.review.input_digests[0].sha256 = "0".repeat(64);
  assert.equal(fx.evaluate().reason, "planning_sessions_incomplete");
});

for (const id of ["CMD-LITE-SCHEMA-VALIDATE", "SYN-ENV-LOCAL", "SYN-L1"]) test(`F3 ${id} is not a proof_cases row`, t => {
  const fx = fixture(t);
  fx.doc.boundary_contract = { trust_boundaries: [{ id: "TRUST-1", crossing: "external -> worker", enforcement: "Authenticate before enqueue", seit_rows: [id] }] };
  rejects(fx.run(), "boundary_seit_row_unresolved");
  fx.doc.boundary_contract.trust_boundaries[0].seit_rows = [fx.seit.proof_cases[0].id];
  assert.deepEqual(fx.run().findings, []);
});
for (const stage of ["draft", "final"]) test(`F4 N/A cannot hide open material gaps at ${stage} freeze`, t => {
  const fx = fixture(t);
  fx.doc.boundary_contract = { not_applicable: true, reason: "Documentation-only", gaps: [{ id: "GAP-1", status: "open" }] };
  rejects(fx.run(stage), "boundary_gap_unresolved");
  fx.doc.boundary_contract.gaps = [];
  assert.deepEqual(fx.run(stage).findings, []);
});
test("F5 every named active authority consumes failing RE findings without a PASS prerequisite", () => {
  const read = rel => readFileSync(path.join(ROOT, rel), "utf8");
  assert.doesNotMatch(read("skills/requirements-engineer/SKILL.md"), /a passing register pre-check receipt/);
  assert.doesNotMatch(read("skills/requirements-engineer/references/precheck.md"), /consumes a passing receipt/);
  assert.doesNotMatch(read("skills/bearing-lite/references/task-state.md"), /mappings are still finalized only after the Requirements\s+Engineer passes/);
  assert.doesNotMatch(read("skills/planning-and-design/references/artifact-grammar.md"), /Requirements Engineer gates it/);
});

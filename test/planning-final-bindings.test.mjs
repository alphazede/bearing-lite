/** Final freeze regressions from the owner-approved three-finding follow-up. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unreviewedPlanningWave } from "./planning-contract-fixture.mjs";

const require = createRequire(import.meta.url);
const { freeze } = require("../hooks/plan-package.cjs");
const { checkRegister } = require("../hooks/register-precheck.cjs");
const read = rel => readFileSync(new URL(rel, import.meta.url), "utf8");
const corpus = JSON.parse(read("./fixtures/planning-repair-package.json"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "final-planning-bindings-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (rel, text) => writeFileSync(path.join(dir, rel), text);
  put(".git", "owned synthetic repository marker");
  put("plan.md", read("./fixtures/register-precheck/plan.md"));
  put("register.sdoc", read("./fixtures/register-precheck/valid.sdoc"));
  put("evidence.txt", read("./fixtures/register-precheck/evidence.txt"));
  put("notes.md", "Unconsumed planning notes.\n");
  const doc = structuredClone(corpus.implementation);
  const seit = structuredClone(corpus.seit);
  seit.proof_cases = ["REG-1", "REG-2"].map((requirement_id, i) => ({
    ...seit.proof_cases[0], id: `SEIT-${i + 1}`, requirement_id,
  }));
  doc.boundary_contract = { not_applicable: true, reason: "Local planning checks; no component boundary changes." };
  doc.journey_settings.journey_type = "specification";
  doc.journey_settings.requirement_register = "register.sdoc";
  doc.journey_settings.planning_wave = unreviewedPlanningWave("0".repeat(64), []);
  const wave = doc.journey_settings.planning_wave;
  let revision = 0;
  function refresh() {
    const register = readFileSync(path.join(dir, "register.sdoc"));
    put("authority.json", JSON.stringify({ requirement_register: { path: "register.sdoc", sha256: sha(register) } }));
    seit.source_baseline.planning_inputs = ["plan.md", "register.sdoc", "notes.md"].map(file => ({ path: file, sha256: sha(readFileSync(path.join(dir, file))) }));
    const bytes = JSON.stringify(seit);
    put("seit.json", bytes);
    const inputs = [...seit.source_baseline.planning_inputs, { path: "seit.json", sha256: sha(bytes) }];
    const digest = sha(inputs.map(row => row.sha256).join("\n"));
    const closing = { candidate_ref: "plan", candidate_revision: `r${++revision}`, candidate_digest: digest };
    doc.journey_settings.planning_review = { candidate_digest: digest };
    Object.assign(wave, { candidate_digest: digest, closing_candidate: closing });
    return { inputs, closing };
  }
  const initial = refresh();
  const run = (stage = "final") => {
    put("implementation.json", JSON.stringify(doc));
    return freeze(dir, { stage });
  };
  return { dir, doc, seit, wave, put, refresh, initial, run };
}
const rejects = result => assert.equal(result.outcome, "FAIL", JSON.stringify(result));

test("final freeze rejects requirements-stage pending case bindings while draft remains valid", t => {
  const fx = fixture(t);
  const register = read("./fixtures/register-precheck/valid.sdoc").replace(/^VERIFICATION_CASE[^\n]*\n/gm, "");
  fx.put("register.sdoc", register);
  fx.refresh();
  const early = checkRegister({ register, technicalPlan: read("./fixtures/register-precheck/plan.md"), files: { "evidence.txt": read("./fixtures/register-precheck/evidence.txt") }, stage: "requirements" });
  assert.equal(early.outcome, "PASS");
  assert.equal(early.pending_bindings.length, 2);
  assert.equal(fx.run("draft").outcome, "PASS");
  const result = fx.run();
  rejects(result);
  assert.ok(result.findings.some(f => f.code === "register_precheck_failed" && f.class === "verification" && f.uid === "REG-1"), JSON.stringify(result));
});

test("final freeze resolves bound case IDs against actual SEIT and accepts valid bindings", t => {
  const fx = fixture(t);
  assert.equal(fx.run().outcome, "PASS");
  fx.seit.proof_cases.pop();
  fx.refresh();
  const result = fx.run();
  rejects(result);
  assert.ok(result.findings.some(f => f.code === "register_precheck_failed" && /SEIT-2/.test(f.message)), JSON.stringify(result));
});

test("an authority-declared register also requires strict final validation", t => {
  const fx = fixture(t);
  delete fx.doc.journey_settings.journey_type;
  delete fx.doc.journey_settings.requirement_register;
  fx.put("register.sdoc", read("./fixtures/register-precheck/valid.sdoc").replace(/^VERIFICATION_CASE[^\n]*\n/gm, ""));
  fx.refresh();
  const result = fx.run();
  rejects(result);
  assert.ok(result.findings.some(f => f.code === "register_precheck_failed" && f.class === "verification"), JSON.stringify(result));
});

for (const name of ["register.sdoc", "plan.md", "seit.json", "evidence.txt"]) {
  test(`final freeze fails closed on unreadable ${name}`, t => {
    const fx = fixture(t);
    rmSync(path.join(fx.dir, name));
    mkdirSync(path.join(fx.dir, name)); // Deterministic unreadable file on any user's permissions.
    const result = fx.run();
    rejects(result);
    assert.ok(result.findings.some(f => name === "evidence.txt"
      ? f.code === "register_precheck_failed" && f.class === "citation"
      : f.code === "planning_input_unreadable"), JSON.stringify(result));
  });
}

test("final register validation rejects missing or ambiguous bound technical-plan context", t => {
  for (const ambiguous of [false, true]) {
    const fx = fixture(t);
    const plan = read("./fixtures/register-precheck/plan.md");
    fx.put("other-technical-plan.md", plan);
    if (ambiguous) fx.seit.source_baseline.planning_inputs.push({ path: "other-technical-plan.md", sha256: sha(plan) });
    else fx.seit.source_baseline.planning_inputs = fx.seit.source_baseline.planning_inputs.filter(row => row.path !== "plan.md");
    const bytes = JSON.stringify(fx.seit);
    fx.put("seit.json", bytes);
    const digest = sha([...fx.seit.source_baseline.planning_inputs.map(row => row.sha256), sha(bytes)].join("\n"));
    fx.doc.journey_settings.planning_review.candidate_digest = digest;
    fx.wave.candidate_digest = digest;
    fx.wave.closing_candidate.candidate_digest = digest;
    const result = fx.run();
    rejects(result);
    assert.ok(result.findings.some(f => f.code === "register_precheck_context_invalid"), JSON.stringify(result));
  }
});

test("no-review closure adopts unchanged consumed inputs without rewriting the original return", t => {
  const fx = fixture(t);
  fx.put("notes.md", "Changed notes outside the specialist's consumed inputs.\n");
  const { closing } = fx.refresh();
  const source = { session: "requirements_engineer", ...fx.initial.closing, verdict: "READY", inputs: [fx.initial.inputs[0]], adopted_to: closing };
  fx.wave.required_sessions = ["requirements_engineer"];
  fx.wave.sessions = [source];
  const original = structuredClone(source);
  assert.equal(fx.run().outcome, "PASS");
  assert.deepEqual(fx.wave.sessions[0], original);
  assert.equal(JSON.parse(readFileSync(path.join(fx.dir, "implementation.json"))).journey_settings.planning_wave.sessions[0].candidate_revision, fx.initial.closing.candidate_revision);
});

test("no-review adoption rejects changed consumed inputs even with a forged recorded snapshot", t => {
  const fx = fixture(t);
  fx.put("plan.md", read("./fixtures/register-precheck/plan.md") + "Changed consumed plan.\n");
  const { closing } = fx.refresh();
  fx.wave.required_sessions = ["requirements_engineer"];
  fx.wave.sessions = [{ session: "requirements_engineer", ...fx.initial.closing, verdict: "READY", inputs: [fx.initial.inputs[0]], adopted_to: closing }];
  fx.wave.input_digests = fx.initial.inputs;
  const result = fx.run();
  rejects(result);
  assert.ok(result.findings.some(f => f.code === "planning_wave_sessions_incomplete"), JSON.stringify(result));
});

test("no-review adoption never trusts recorded hashes over changed bytes", t => {
  const fx = fixture(t);
  const closing = fx.initial.closing;
  fx.wave.required_sessions = ["requirements_engineer"];
  fx.wave.sessions = [{ session: "requirements_engineer", ...closing, candidate_revision: "earlier", verdict: "READY", inputs: [fx.initial.inputs[0]], adopted_to: closing }];
  fx.put("plan.md", "Changed without refreshing the manifest.\n");
  const result = fx.run();
  rejects(result);
  assert.ok(result.findings.some(f => f.code === "digest_mismatch"), JSON.stringify(result));
});

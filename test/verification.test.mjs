/**
 * SEIT-BDL-004 / AC-BDL-009 / DES-BDL-008
 * Candidate-bound deterministic verification: diagnostic vs assurance.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const adapter = require(path.join(ROOT, "hooks/verification.cjs"));

const REV = "b5cec79f04f6f6ea506a2ad89bf937aab143d876";
const DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EVIDENCE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const STALE_EVIDENCE = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const command = { command: "reverify check --claim SEIT-SYN-BIN-001", config: { binary: "firmware.bin" } };

const author = {
  role: "implementer",
  identity: "author-1",
  session: "sess-impl",
};

const ate = {
  role: "test_engineer.assurance",
  identity: "ate-1",
  session: "sess-ate",
};

const coordinator = {
  role: "coordinator",
  identity: "coord-1",
  session: "sess-close",
};

function request(extra = {}) {
  return {
    schema_version: "1",
    kind: "request",
    candidate_ref: "cand-1",
    candidate_revision: REV,
    candidate_digest: DIGEST,
    claim_id: "SEIT-SYN-BIN-001",
    claim_type: "binary_reachability",
    backend: "reverify",
    stage: "assurance",
    authority: "assurance",
    expected_result: "VERIFIED",
    command_configuration: { ...command },
    selected: true,
    required: true,
    ...extra,
  };
}

function receipt(extra = {}) {
  const produced = extra.produced_by;
  const rest = { ...extra };
  delete rest.produced_by;
  return {
    schema_version: "1",
    kind: "receipt",
    status: "VERIFIED",
    candidate_ref: "cand-1",
    candidate_revision: REV,
    candidate_digest: DIGEST,
    claim_id: "SEIT-SYN-BIN-001",
    backend: "reverify",
    backend_version: "reverify-0.0-test",
    command_configuration: { ...command },
    evidence_digest: EVIDENCE,
    authority: "assurance",
    produced_by: produced || ate,
    stage: "assurance",
    ...rest,
  };
}

const available = { name: "reverify", enabled: true, available: true, version: "reverify-0.0-test" };

function evaluate(extra = {}) {
  return adapter.evaluateVerification({
    request: request(),
    receipt: receipt(),
    candidate: { candidate_ref: "cand-1", candidate_revision: REV, candidate_digest: DIGEST },
    author,
    gate: "assurance",
    backend: available,
    ...extra,
  });
}

describe("SEIT-BDL-004 deterministic verification adapter", () => {
  it("ships the schema and a HOOK_CLASS-free evaluator", () => {
    assert.equal(existsSync(path.join(ROOT, "schemas/verification.schema.json")), true);
    const schema = JSON.parse(readFileSync(path.join(ROOT, "schemas/verification.schema.json"), "utf8"));
    assert.equal(schema.$id.endsWith("verification.schema.json"), true);
    assert.equal(Object.hasOwn(adapter, "HOOK_CLASS"), false);
    assert.equal(typeof adapter.evaluateVerification, "function");
    const skill = readFileSync(path.join(ROOT, "skills/bearing-lite/references/verification.md"), "utf8");
    assert.match(skill, /never satisfy an assurance gate/);
    assert.match(skill, /never downloads/);
  });

  it("positive valid independent assurance claim is gate-eligible PASS", () => {
    const got = evaluate();
    assert.equal(got.outcome, "PASS");
    assert.equal(got.reason, "independent_assurance_verified");
    assert.equal(got.status, "VERIFIED");
    assert.equal(got.authority, "assurance");
    assert.equal(got.gate_eligible, true);
    assert.equal(got.closure_eligible, false);
    assert.equal(got.rereview, false);
    assert.equal(got.download_attempted, false);
    assert.equal(got.backend_is_role, false);
  });

  it("candidate mismatch is rejected and is not gate-eligible", () => {
    const got = evaluate({
      candidate: { candidate_ref: "cand-1", candidate_revision: "0".repeat(40), candidate_digest: DIGEST },
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "candidate_mismatch");
    assert.equal(got.gate_eligible, false);
  });

  it("rejects a receipt that omits a digest supplied by the request and current candidate", () => {
    const unbound = receipt();
    delete unbound.candidate_digest;
    const got = evaluate({ receipt: unbound });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "candidate_mismatch");
    assert.equal(got.gate_eligible, false);
  });

  it("rejects a receipt whose digest differs from the supplied candidate digest", () => {
    const got = evaluate({
      receipt: receipt({ candidate_digest: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }),
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "candidate_mismatch");
    assert.equal(got.gate_eligible, false);
  });

  it("matches revision-only when neither request, candidate, nor receipt supplies a digest", () => {
    const req = request();
    delete req.candidate_digest;
    const rec = receipt();
    delete rec.candidate_digest;
    const got = adapter.evaluateVerification({
      request: req,
      receipt: rec,
      candidate: { candidate_ref: "cand-1", candidate_revision: REV },
      author,
      gate: "assurance",
      backend: available,
    });
    assert.equal(got.outcome, "PASS");
    assert.equal(got.reason, "independent_assurance_verified");
    assert.equal(got.gate_eligible, true);
  });

  it("author diagnostic submitted as assurance is rejected", () => {
    const got = evaluate({
      request: request({ authority: "diagnostic", stage: "implementation" }),
      receipt: receipt({
        authority: "diagnostic",
        stage: "implementation",
        produced_by: author,
      }),
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "diagnostic_cannot_satisfy_assurance_gate");
    assert.equal(got.gate_eligible, false);
    assert.equal(got.authority, "diagnostic");
  });

  it("self-certification: author identity on an assurance receipt is rejected", () => {
    const got = evaluate({
      receipt: receipt({ produced_by: { ...ate, identity: author.identity } }),
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "self_certification");
    assert.equal(got.gate_eligible, false);
  });

  it("self-certification: author session on an assurance receipt is rejected", () => {
    const got = evaluate({
      receipt: receipt({ produced_by: { ...ate, session: author.session } }),
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "self_certification");
    assert.equal(got.gate_eligible, false);
  });

  it("unavailable backend when selected is ERROR, not PASS", () => {
    const got = evaluate({
      backend: { name: "reverify", enabled: true, available: false },
    });
    assert.equal(got.outcome, "ERROR");
    assert.equal(got.reason, "backend_unavailable");
    assert.equal(got.status, "ERROR");
    assert.equal(got.gate_eligible, false);
    assert.equal(got.download_attempted, false);
  });

  it("unavailable backend when required is ERROR even if not selected", () => {
    const got = evaluate({
      request: request({ selected: false, required: true }),
      backend: { name: "reverify", enabled: false, available: false },
    });
    assert.equal(got.outcome, "ERROR");
    assert.equal(got.reason, "backend_unavailable");
    assert.equal(got.download_attempted, false);
  });

  it("unselected and unrequired absence is inactive, not a global failure", () => {
    const got = adapter.evaluateVerification({
      request: request({ selected: false, required: false, authority: "diagnostic", stage: "implementation" }),
      candidate: { candidate_ref: "cand-1", candidate_revision: REV, candidate_digest: DIGEST },
      author,
      gate: "none",
      backend: { name: "reverify", enabled: false, available: false },
    });
    assert.equal(got.outcome, "INACTIVE");
    assert.equal(got.reason, "backend_unselected_unrequired");
    assert.equal(got.gate_eligible, false);
    assert.equal(got.download_attempted, false);
  });

  it("INCONCLUSIVE cannot satisfy an assurance gate", () => {
    const got = evaluate({
      receipt: receipt({ status: "INCONCLUSIVE" }),
    });
    assert.equal(got.outcome, "INCONCLUSIVE");
    assert.equal(got.reason, "inconclusive_cannot_satisfy_gate");
    assert.equal(got.gate_eligible, false);
  });

  it("stale evidence digest after repair is rejected", () => {
    const got = evaluate({
      gate: "post_repair_closure",
      request: request({ stage: "post_repair_closure" }),
      receipt: receipt({
        stage: "post_repair_closure",
        evidence_digest: STALE_EVIDENCE,
        produced_by: coordinator,
      }),
      repair: { post_repair: true, prior_candidate_revision: REV, prior_evidence_digest: STALE_EVIDENCE },
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "stale_evidence");
    assert.equal(got.gate_eligible, false);
    assert.equal(got.closure_eligible, false);
  });

  it("stale pre-repair candidate on a repaired HEAD is rejected", () => {
    const repaired = "c".repeat(40);
    const got = evaluate({
      gate: "post_repair_closure",
      request: request({ stage: "post_repair_closure", candidate_revision: repaired }),
      receipt: receipt({
        stage: "post_repair_closure",
        candidate_revision: REV,
        produced_by: coordinator,
      }),
      candidate: { candidate_ref: "cand-1", candidate_revision: repaired, candidate_digest: DIGEST },
      repair: { post_repair: true, prior_candidate_revision: REV, prior_evidence_digest: STALE_EVIDENCE },
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "candidate_mismatch");
    assert.equal(got.closure_eligible, false);
  });

  it("post-repair closure accepts a fresh independent rerun and does not rereview", () => {
    const repaired = "d".repeat(40);
    const fresh = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const got = evaluate({
      gate: "post_repair_closure",
      request: request({ stage: "post_repair_closure", candidate_revision: repaired }),
      receipt: receipt({
        stage: "post_repair_closure",
        candidate_revision: repaired,
        evidence_digest: fresh,
        produced_by: coordinator,
      }),
      candidate: { candidate_ref: "cand-1", candidate_revision: repaired, candidate_digest: DIGEST },
      repair: { post_repair: true, prior_candidate_revision: REV, prior_evidence_digest: EVIDENCE },
    });
    assert.equal(got.outcome, "PASS");
    assert.equal(got.reason, "post_repair_deterministic_closure");
    assert.equal(got.closure_eligible, true);
    assert.equal(got.gate_eligible, false);
    assert.equal(got.rereview, false);
  });

  it("author diagnostic cannot close post-repair", () => {
    const repaired = "d".repeat(40);
    const fresh = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const got = evaluate({
      gate: "post_repair_closure",
      request: request({
        stage: "post_repair_closure",
        candidate_revision: repaired,
        authority: "diagnostic",
      }),
      receipt: receipt({
        stage: "post_repair_closure",
        candidate_revision: repaired,
        evidence_digest: fresh,
        authority: "diagnostic",
        produced_by: author,
      }),
      candidate: { candidate_ref: "cand-1", candidate_revision: repaired, candidate_digest: DIGEST },
      repair: { post_repair: true, prior_candidate_revision: REV, prior_evidence_digest: EVIDENCE },
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "self_certification");
    assert.equal(got.closure_eligible, false);
    assert.equal(got.rereview, false);
  });

  it("automatic rereview after repair is prohibited", () => {
    const repaired = "d".repeat(40);
    const fresh = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const got = evaluate({
      gate: "post_repair_closure",
      review_after_repair: true,
      request: request({ stage: "post_repair_closure", candidate_revision: repaired }),
      receipt: receipt({
        stage: "post_repair_closure",
        candidate_revision: repaired,
        evidence_digest: fresh,
        produced_by: coordinator,
      }),
      candidate: { candidate_ref: "cand-1", candidate_revision: repaired, candidate_digest: DIGEST },
      repair: { post_repair: true, prior_candidate_revision: REV, prior_evidence_digest: EVIDENCE },
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "automatic_rereview_prohibited");
    assert.equal(got.rereview, false);
  });

  it("never downloads Reverify even when asked", () => {
    let called = 0;
    const got = adapter.evaluateVerification({
      download: true,
      install: true,
      download_fn: () => {
        called += 1;
        return "downloaded";
      },
      request: request({ selected: true, required: true }),
      candidate: { candidate_ref: "cand-1", candidate_revision: REV, candidate_digest: DIGEST },
      author,
      gate: "assurance",
      backend: { name: "reverify", enabled: false, available: false },
    });
    assert.equal(called, 0);
    assert.equal(got.download_attempted, false);
    assert.equal(got.outcome, "ERROR");
    assert.equal(got.reason, "backend_unavailable");
  });

  it("receipt must bind command/configuration; mismatch is rejected", () => {
    const got = evaluate({
      receipt: receipt({ command_configuration: { command: "other" } }),
    });
    assert.equal(got.outcome, "REJECT");
    assert.equal(got.reason, "claim_or_backend_mismatch");
    assert.equal(got.gate_eligible, false);
  });

  it("implementer diagnostic without an assurance gate is recorded, not PASS-for-assurance", () => {
    const got = adapter.evaluateVerification({
      request: request({
        authority: "diagnostic",
        stage: "implementation",
        selected: true,
        required: false,
      }),
      receipt: receipt({
        authority: "diagnostic",
        stage: "implementation",
        produced_by: author,
      }),
      candidate: { candidate_ref: "cand-1", candidate_revision: REV, candidate_digest: DIGEST },
      author,
      gate: "none",
      backend: available,
    });
    assert.equal(got.outcome, "PASS");
    assert.equal(got.reason, "diagnostic_receipt_recorded");
    assert.equal(got.authority, "diagnostic");
    assert.equal(got.gate_eligible, false);
  });
});

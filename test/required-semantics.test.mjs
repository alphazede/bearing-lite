/**
 * Issue #111: `required` vs `enabled` on activated-but-unavailable.
 * Typed-gap outcome/reason strings stay; the proceed signal diverges.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const coverage = require(path.join(ROOT, "hooks/review-capability.cjs"));
const verification = require(path.join(ROOT, "hooks/verification.cjs"));

const REV = "b5cec79f04f6f6ea506a2ad89bf937aab143d876";
const BASE = "7ee098db3c2b1746a50222746c6a2428822ce4dd";
const DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EVIDENCE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const HALT = "halt";
const NOTE = "proceed-with-note";

function planUnavailable(declared) {
  return coverage.planCoverage({
    capability: "coverage-tool",
    candidate: { candidate_ref: "cand-1", candidate_revision: REV, diff_base: BASE },
    declared,
  });
}

function evaluateUnavailable({ selected, required }) {
  return verification.evaluateVerification({
    request: {
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
      command_configuration: { command: "reverify check" },
      selected,
      required,
    },
    receipt: {
      schema_version: "1",
      kind: "receipt",
      status: "VERIFIED",
      candidate_ref: "cand-1",
      candidate_revision: REV,
      candidate_digest: DIGEST,
      claim_id: "SEIT-SYN-BIN-001",
      backend: "reverify",
      backend_version: "reverify-0.0-test",
      command_configuration: { command: "reverify check" },
      evidence_digest: EVIDENCE,
      authority: "assurance",
      produced_by: { role: "test_engineer.assurance", identity: "ate-1", session: "sess-ate" },
      stage: "assurance",
    },
    candidate: { candidate_ref: "cand-1", candidate_revision: REV, candidate_digest: DIGEST },
    author: { role: "implementer", identity: "author-1", session: "sess-impl" },
    gate: "assurance",
    backend: { name: "reverify", enabled: true, available: false },
  });
}

describe("#111 required vs enabled unavailable semantics", () => {
  it("enabled-and-unavailable proceeds with a note; required-and-unavailable halts", () => {
    const enabledReview = planUnavailable({ enabled: true, required: false, available: false });
    const requiredReview = planUnavailable({ enabled: false, required: true, available: false });
    const bothReview = planUnavailable({ enabled: true, required: true, available: false });

    assert.equal(enabledReview.outcome, "UNAVAILABLE");
    assert.equal(enabledReview.reason, "typed_capability_gap");
    assert.equal(requiredReview.outcome, "UNAVAILABLE");
    assert.equal(requiredReview.reason, "typed_capability_gap");
    assert.equal(bothReview.outcome, "UNAVAILABLE");
    assert.equal(bothReview.reason, "typed_capability_gap");

    assert.equal(enabledReview.proceed, NOTE);
    assert.equal(requiredReview.proceed, HALT);
    assert.equal(bothReview.proceed, HALT);
    assert.notEqual(enabledReview.proceed, requiredReview.proceed);

    const enabledVerify = evaluateUnavailable({ selected: true, required: false });
    const requiredVerify = evaluateUnavailable({ selected: false, required: true });
    const bothVerify = evaluateUnavailable({ selected: true, required: true });

    assert.equal(enabledVerify.outcome, "ERROR");
    assert.equal(enabledVerify.reason, "backend_unavailable");
    assert.equal(requiredVerify.outcome, "ERROR");
    assert.equal(requiredVerify.reason, "backend_unavailable");
    assert.equal(bothVerify.outcome, "ERROR");
    assert.equal(bothVerify.reason, "backend_unavailable");

    assert.equal(enabledVerify.proceed, NOTE);
    assert.equal(requiredVerify.proceed, HALT);
    assert.equal(bothVerify.proceed, HALT);
    assert.equal(enabledVerify.proceed, enabledReview.proceed);
    assert.equal(requiredVerify.proceed, requiredReview.proceed);
  });
});

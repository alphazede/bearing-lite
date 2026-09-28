"use strict";
/**
 * Builds test/fixtures/sealed-receipts.reverify.json: receipts exactly as
 * sealVerification emits them, so schema validation covers the real output
 * shape (including evidence_tier, backend_verdict and evidence_engine).
 * Run: node test/build-sealed-receipt-fixture.cjs > test/fixtures/sealed-receipts.reverify.json
 */
const path = require("node:path");
const bridge = require(path.join(__dirname, "..", "hooks", "verification-bridge.cjs"));

const candidate = {
  candidate_ref: "cand-1",
  candidate_revision: "b5cec79f04f6f6ea506a2ad89bf937aab143d876",
  candidate_digest: "a".repeat(64),
};
const spec = {
  backend: "reverify",
  backend_operation: "verify",
  backend_operations: { allowed: ["verify"], denied: ["reconstruct"] },
  invocation: {
    executable: "reverify",
    argv_template: ["{operation}", "{target}", "--claim", "{claim}", "--json"],
  },
  claim_id: "SEIT-BDL-BIN-001",
  claim_type: "binary_section",
  claim: { kind: "section_present", name: ".text" },
  target: "firmware.bin",
  candidate,
  stage: "assurance",
  authority: "assurance",
  expected_result: "VERIFIED",
  selected: true,
  required: true,
};
const who = { role: "test_engineer.assurance", identity: "ate-1", session: "sess-ate" };

function build() {
  const plan = bridge.planVerification(spec);
  if (plan.outcome !== "READY") throw new Error(`plan not READY: ${plan.reason}`);
  const outputs = {
    observed: {
      backend_version: "reverify 0.9.0",
      results: [{ claim_id: spec.claim_id, verdict: "VERIFIED" }],
    },
    derived: {
      backend_version: "reverify 0.9.0",
      results: [{
        claim_id: spec.claim_id,
        verdict: "VERIFIED",
        evidence: { strength: "derived", engine: "cfg-recovery", engine_version: "1.2.0" },
      }],
    },
  };
  const receipts = {};
  for (const [key, output] of Object.entries(outputs)) {
    const sealed = bridge.sealVerification({ plan, output, produced_by: who });
    if (sealed.outcome !== "READY") throw new Error(`${key} not sealed: ${sealed.reason}`);
    receipts[key] = sealed.receipt;
  }
  return { description: "Receipts exactly as sealVerification emits them. Regenerate with test/build-sealed-receipt-fixture.cjs.", receipts };
}

module.exports = { build };
if (require.main === module) process.stdout.write(`${JSON.stringify(build(), null, 2)}\n`);

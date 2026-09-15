/**
 * Issue #105: deterministic verification receipt bridge.
 * Shapes a matched request/receipt pair the verification adapter admits.
 * Never invokes a backend; the caller runs the command and hands back output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const bridge = require(path.join(ROOT, "hooks/verification-bridge.cjs"));
const adapter = require(path.join(ROOT, "hooks/verification.cjs"));

const REV = "b5cec79f04f6f6ea506a2ad89bf937aab143d876";
const DIGEST = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const candidate = {
  candidate_ref: "cand-1",
  candidate_revision: REV,
  candidate_digest: DIGEST,
};

const ate = { role: "test_engineer.assurance", identity: "ate-1", session: "sess-ate" };
const author = { role: "implementer", identity: "author-1", session: "sess-impl" };

function spec(extra = {}) {
  return {
    backend: "reverify",
    backend_operation: "verify",
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
    ...extra,
  };
}

/** A backend result as reverify --json emits it. */
function output(extra = {}) {
  const result = {
    kind: "section_present",
    verdict: "VERIFIED",
    detail: "section present",
    evidence: { format: "ELF", backend: "lief" },
    ...(extra.result || {}),
  };
  const out = { backend_version: "reverify 0.10.0", results: [result] };
  delete extra.result;
  return { ...out, ...extra };
}

function planned(extra = {}) {
  const plan = bridge.planVerification(spec(extra));
  assert.equal(plan.outcome, "READY", JSON.stringify(plan));
  return plan;
}

function sealed(planExtra = {}, out = output(), produced_by = ate) {
  return bridge.sealVerification({ plan: planned(planExtra), output: out, produced_by });
}

describe("verification receipt bridge (#105)", () => {
  it("never invokes a backend: no child process surface in the module", () => {
    const source = require("node:fs").readFileSync(
      path.join(ROOT, "hooks/verification-bridge.cjs"),
      "utf8",
    );
    assert.doesNotMatch(source, /child_process|execSync|spawnSync|\bspawn\(/);
  });

  it("plans a request and the exact command configuration to run", () => {
    const plan = planned();
    assert.equal(plan.request.kind, "request");
    assert.equal(plan.request.schema_version, "1");
    assert.equal(plan.request.claim_id, "SEIT-BDL-BIN-001");
    assert.equal(plan.request.backend, "reverify");
    assert.equal(plan.request.authority, "assurance");
    assert.equal(plan.request.selected, true);
    assert.ok(Array.isArray(plan.argv) && plan.argv.length > 0, "argv is runnable");
    assert.ok(
      Object.keys(plan.request.command_configuration).length > 0,
      "command_configuration is non-empty",
    );
  });

  // Trap 2: a generative backend operation may never produce assurance evidence.
  it("refuses a generative backend operation", () => {
    const plan = bridge.planVerification(spec({ backend_operation: "reconstruct" }));
    assert.equal(plan.outcome, "REJECT");
    assert.equal(plan.reason, "generative_backend_operation_denied");
    assert.equal(plan.request, undefined, "no request is produced");
  });

  it("refuses an unknown backend operation rather than guessing", () => {
    const plan = bridge.planVerification(spec({ backend_operation: "emulate-and-hope" }));
    assert.equal(plan.outcome, "REJECT");
    assert.equal(plan.reason, "backend_operation_unsupported");
  });

  // Authority is never defaulted: the same tool serves two authority levels.
  it("requires an explicit authority", () => {
    const plan = bridge.planVerification(spec({ authority: undefined }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "authority_unspecified");
  });

  it("rejects an authority outside the adapter's vocabulary", () => {
    const plan = bridge.planVerification(spec({ authority: "owner" }));
    assert.equal(plan.outcome, "REJECT");
    assert.equal(plan.reason, "authority_invalid");
  });

  it("requires a bound candidate", () => {
    const plan = bridge.planVerification(spec({ candidate: { candidate_ref: "cand-1" } }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "candidate_unbound");
  });

  it("requires a claim carrying a kind", () => {
    const plan = bridge.planVerification(spec({ claim: { name: ".text" } }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "claim_unbound");
  });

  it("seals a verified run into a receipt the adapter admits", () => {
    const seal = sealed();
    assert.equal(seal.outcome, "READY", JSON.stringify(seal));
    assert.equal(seal.receipt.status, "VERIFIED");
    assert.equal(seal.receipt.authority, "assurance");
    assert.equal(seal.receipt.backend_version, "reverify 0.10.0");
    assert.match(seal.receipt.evidence_digest, /^[0-9a-f]{64}$/);

    const verdict = adapter.evaluateVerification({
      request: planned().request,
      receipt: seal.receipt,
      candidate,
      backend: { name: "reverify", enabled: true, available: true },
      author,
      gate: "assurance",
    });
    assert.equal(verdict.gate_eligible, true, JSON.stringify(verdict));
  });

  it("seals a refuted run and the gate refuses it when VERIFIED was expected", () => {
    const seal = sealed({}, output({ result: { verdict: "REFUTED", detail: "section absent" } }));
    assert.equal(seal.receipt.status, "REFUTED");
    const verdict = adapter.evaluateVerification({
      request: planned().request,
      receipt: seal.receipt,
      candidate,
      backend: { name: "reverify", enabled: true, available: true },
      author,
      gate: "assurance",
    });
    assert.equal(verdict.gate_eligible, false);
  });

  // Trap 1: an analysis-derived verdict must not carry the weight of an observed one.
  it("downgrades an analysis-derived verdict so it cannot satisfy a gate", () => {
    const derived = output({
      result: {
        kind: "reachable_from_entry",
        verdict: "VERIFIED",
        detail: "reachable",
        evidence: {
          engine: "angr",
          engine_version: "9.3.4",
          strength: "DERIVED: recovered by static analysis, not read from the bytes",
        },
      },
    });
    const seal = sealed({ claim: { kind: "reachable_from_entry", name: "risk_check" } }, derived);
    assert.equal(seal.outcome, "READY");
    assert.equal(seal.receipt.status, "INCONCLUSIVE", "derived verdicts are not gate-passing");
    assert.equal(seal.receipt.evidence_tier, "derived");
    assert.equal(seal.receipt.backend_verdict, "VERIFIED", "the raw verdict stays visible");

    const verdict = adapter.evaluateVerification({
      request: planned({ claim: { kind: "reachable_from_entry", name: "risk_check" } }).request,
      receipt: seal.receipt,
      candidate,
      backend: { name: "reverify", enabled: true, available: true },
      author,
      gate: "assurance",
    });
    assert.equal(verdict.gate_eligible, false);
    assert.equal(verdict.reason, "inconclusive_cannot_satisfy_gate");
  });

  it("marks a directly observed verdict as observed", () => {
    assert.equal(sealed().receipt.evidence_tier, "observed");
  });

  // Trap 3: a malformed claim is a loud failure, never a quiet unproven receipt.
  it("reports a malformed claim as a typed error instead of a receipt", () => {
    const malformed = output({
      result: {
        verdict: "INCONCLUSIVE",
        detail: "malformed claim: section_present requires 'name'",
        evidence: {},
      },
    });
    const seal = sealed({}, malformed);
    assert.equal(seal.outcome, "REJECT");
    assert.equal(seal.reason, "claim_malformed");
    assert.equal(seal.receipt, undefined, "no receipt is emitted for a malformed claim");
    assert.match(seal.detail, /requires 'name'/);
  });

  it("still seals a genuine inconclusive result", () => {
    const seal = sealed(
      {},
      output({ result: { verdict: "INCONCLUSIVE", detail: "no engine available", evidence: {} } }),
    );
    assert.equal(seal.outcome, "READY");
    assert.equal(seal.receipt.status, "INCONCLUSIVE");
  });

  it("requires a backend version from the run rather than assuming one", () => {
    const seal = sealed({}, output({ backend_version: undefined }));
    assert.equal(seal.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(seal.reason, "backend_version_missing");
  });

  it("requires a produced_by identity with role, identity and session", () => {
    const seal = sealed({}, output(), { role: "test_engineer.assurance" });
    assert.equal(seal.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(seal.reason, "produced_by_unbound");
  });

  it("binds evidence_digest to the backend output so a changed run changes the digest", () => {
    const a = sealed().receipt.evidence_digest;
    const b = sealed({}, output({ result: { detail: "section present (rerun)" } })).receipt
      .evidence_digest;
    assert.notEqual(a, b);
    assert.equal(a, sealed().receipt.evidence_digest, "same output yields the same digest");
  });

  it("computes evidence_digest as sha256 over canonical JSON of the backend result", () => {
    const seal = sealed();
    const canonical = bridge.canonicalJson(output());
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
    assert.equal(seal.receipt.evidence_digest, expected);
  });

  it("keeps request and receipt command_configuration deeply equal", () => {
    const plan = planned();
    const seal = bridge.sealVerification({ plan, output: output(), produced_by: ate });
    assert.deepEqual(seal.receipt.command_configuration, plan.request.command_configuration);
  });

  it("carries a diagnostic authority through without promoting it", () => {
    const seal = sealed({ authority: "diagnostic", stage: "implementation" }, output(), author);
    assert.equal(seal.receipt.authority, "diagnostic");
    const verdict = adapter.evaluateVerification({
      request: planned({ authority: "diagnostic", stage: "implementation" }).request,
      receipt: seal.receipt,
      candidate,
      backend: { name: "reverify", enabled: true, available: true },
      author,
      gate: "assurance",
    });
    assert.equal(verdict.gate_eligible, false);
    assert.equal(verdict.reason, "diagnostic_cannot_satisfy_assurance_gate");
  });

  it("is backend neutral: it names no backend and no engine in its logic", () => {
    const source = require("node:fs").readFileSync(
      path.join(ROOT, "hooks/verification-bridge.cjs"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /reverify|angr|capstone|unicorn|lief/i);
  });
});

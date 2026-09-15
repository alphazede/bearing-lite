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
    ...extra,
  };
}

/** Rebuild the runnable command from a stored command_configuration alone. */
function reassemble(commandConfiguration) {
  const { invocation, operation, target, claim, args } = commandConfiguration;
  const out = [invocation.executable];
  for (const entry of invocation.argv_template) {
    if (entry === "{operation}") out.push(operation);
    else if (entry === "{target}") out.push(target);
    else if (entry === "{claim}") out.push(claim);
    else if (entry === "{args}") out.push(...args);
    else out.push(entry);
  }
  if (!invocation.argv_template.includes("{args}")) out.push(...args);
  return out;
}

/** A differently-shaped backend: checksum identity over a target artifact. */
function checksumSpec(extra = {}) {
  return {
    backend: "checksum",
    backend_operation: "digest",
    backend_operations: { allowed: ["digest"], denied: ["synthesize"] },
    invocation: {
      executable: "sha256sum",
      argv_template: ["{target}", "{operation}", "--expect", "{claim}"],
    },
    claim_id: "SEIT-BDL-BIN-002",
    claim_type: "binary_identity",
    claim: { kind: "checksum_match", sha256: DIGEST },
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

function checksumOutput(extra = {}) {
  const result = {
    kind: "checksum_match",
    verdict: "VERIFIED",
    detail: "checksum matches",
    evidence: {},
    ...(extra.result || {}),
  };
  const out = { backend_version: "checksum 1.2.3", results: [result] };
  delete extra.result;
  return { ...out, ...extra };
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
    assert.deepEqual(plan.argv, [
      "reverify",
      "verify",
      "firmware.bin",
      "--claim",
      bridge.canonicalJson({ kind: "section_present", name: ".text" }),
      "--json",
    ]);
    assert.deepEqual(
      reassemble(plan.request.command_configuration),
      plan.argv,
      "the receipt alone rebuilds the command",
    );
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

  it("is invocation-shape independent: the caller template fixes argv layout, not the bridge", () => {
    const source = require("node:fs").readFileSync(
      path.join(ROOT, "hooks/verification-bridge.cjs"),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /reverify|angr|capstone|unicorn|lief/i);
    // A fixed layout returning here fails this test: the old hardcoded flags
    // must not survive in the bridge in any form.
    assert.doesNotMatch(code, /--claim|--json/);

    const claimed = bridge.canonicalJson({ kind: "section_present", name: ".text" });
    const alt = ["{target}", "{operation}", "--expect", "{claim}"];
    const plan = planned({
      invocation: { executable: "reverify", argv_template: alt },
    });
    assert.deepEqual(plan.argv, ["reverify", "firmware.bin", "verify", "--expect", claimed]);
    assert.deepEqual(plan.request.command_configuration.invocation.argv_template, alt);
    assert.deepEqual(
      reassemble(plan.request.command_configuration),
      plan.argv,
      "an unfamiliar layout still rebuilds from the receipt alone",
    );

    // Extra args splice at the declared slot, or append when it is absent.
    const spliced = planned({
      invocation: {
        executable: "reverify",
        argv_template: ["{operation}", "{args}", "{target}", "{claim}"],
      },
      args: ["--strict"],
    });
    assert.deepEqual(spliced.argv, [
      "reverify",
      "verify",
      "--strict",
      "firmware.bin",
      claimed,
    ]);
    const appended = planned({ args: ["--strict"] });
    assert.equal(appended.argv.at(-1), "--strict");
  });

  it("requires the caller-stated operation policy and invocation shape", () => {
    const noPolicy = bridge.planVerification(spec({ backend_operations: undefined }));
    assert.equal(noPolicy.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(noPolicy.reason, "backend_operations_unbound");

    const emptyPolicy = bridge.planVerification(
      spec({ backend_operations: { allowed: [], denied: [] } }),
    );
    assert.equal(emptyPolicy.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(emptyPolicy.reason, "backend_operations_unbound");

    const noShape = bridge.planVerification(spec({ invocation: undefined }));
    assert.equal(noShape.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(noShape.reason, "invocation_unbound");

    const missingSlot = bridge.planVerification(
      spec({ invocation: { executable: "reverify", argv_template: ["{operation}", "{target}"] } }),
    );
    assert.equal(missingSlot.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(missingSlot.reason, "invocation_unbound");
  });

  it("enforces the caller policy per backend instead of a bridge-wide list", () => {
    const denied = bridge.planVerification(
      checksumSpec({ backend_operation: "synthesize" }),
    );
    assert.equal(denied.outcome, "REJECT");
    assert.equal(denied.reason, "generative_backend_operation_denied");
    assert.equal(denied.request, undefined, "no request is produced");

    // The other backend's allowed operation is unlisted here, so it is refused.
    const unlisted = bridge.planVerification(checksumSpec({ backend_operation: "verify" }));
    assert.equal(unlisted.outcome, "REJECT");
    assert.equal(unlisted.reason, "backend_operation_unsupported");
  });

  it("ignores a caller-supplied argv so raw text cannot bypass policy", () => {
    const plan = bridge.planVerification(
      spec({ argv: ["reverify", "reconstruct", "firmware.bin", "--claim", "{}", "--json"] }),
    );
    assert.equal(plan.outcome, "READY");
    assert.deepEqual(plan.argv, [
      "reverify",
      "verify",
      "firmware.bin",
      "--claim",
      bridge.canonicalJson({ kind: "section_present", name: ".text" }),
      "--json",
    ]);

    const smuggled = bridge.planVerification(
      spec({
        backend_operation: "reconstruct",
        argv: ["reverify", "verify", "firmware.bin"],
      }),
    );
    assert.equal(smuggled.outcome, "REJECT");
    assert.equal(smuggled.reason, "generative_backend_operation_denied");
  });

  it("plans and seals a checksum identity claim from a differently-shaped backend", () => {
    const plan = bridge.planVerification(checksumSpec());
    assert.equal(plan.outcome, "READY", JSON.stringify(plan));
    assert.deepEqual(plan.argv, [
      "sha256sum",
      "firmware.bin",
      "digest",
      "--expect",
      bridge.canonicalJson({ kind: "checksum_match", sha256: DIGEST }),
    ]);
    assert.ok(!plan.argv.includes("--claim") && !plan.argv.includes("--json"));

    const seal = bridge.sealVerification({
      plan,
      output: checksumOutput(),
      produced_by: ate,
    });
    assert.equal(seal.outcome, "READY", JSON.stringify(seal));
    assert.equal(seal.receipt.status, "VERIFIED");
    assert.deepEqual(
      seal.receipt.command_configuration,
      plan.request.command_configuration,
    );
    assert.deepEqual(reassemble(seal.receipt.command_configuration), plan.argv);

    const verdict = adapter.evaluateVerification({
      request: plan.request,
      receipt: seal.receipt,
      candidate,
      backend: { name: "checksum", enabled: true, available: true },
      author,
      gate: "assurance",
    });
    assert.equal(verdict.outcome, "PASS", JSON.stringify(verdict));
    assert.equal(verdict.gate_eligible, true, JSON.stringify(verdict));
  });
});

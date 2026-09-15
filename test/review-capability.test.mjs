/**
 * Issue #104: parallel review capability.
 * A second detection path the Reviewer may invoke, without anchoring its own
 * first-pass findings on that path's output. Never a role, never an authority.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const capability = require(path.join(ROOT, "hooks/review-capability.cjs"));

const REV = "b5cec79f04f6f6ea506a2ad89bf937aab143d876";
const BASE = "7ee098db3c2b1746a50222746c6a2428822ce4dd";

const candidate = { candidate_ref: "cand-1", candidate_revision: REV, diff_base: BASE };

function spec(extra = {}) {
  return {
    capability: "external-review",
    capability_command: "review",
    candidate,
    output_path: "findings.json",
    enabled: true,
    required: false,
    ...extra,
  };
}

const own = [
  { id: "R-1", file: "src/a.js", line: 10, severity: "P1", summary: "unchecked index" },
  { id: "R-2", file: "src/b.js", line: 4, severity: "P3", summary: "dead branch" },
];

const external = [
  { file: "src/a.js", line: 10, severity: "P2", summary: "index may exceed length" },
  { file: "src/c.js", line: 99, severity: "P1", summary: "sql built by concatenation" },
];

function frozen(findings = own) {
  const f = capability.freezeFindings({ findings, candidate });
  assert.equal(f.outcome, "READY", JSON.stringify(f));
  return f;
}

describe("parallel review capability (#104)", () => {
  it("never invokes the capability: no child process surface", () => {
    const source = readFileSync(path.join(ROOT, "hooks/review-capability.cjs"), "utf8");
    assert.doesNotMatch(source, /child_process|execSync|spawnSync|\bspawn\(/);
  });

  it("names no specific review tool in its logic", () => {
    const source = readFileSync(path.join(ROOT, "hooks/review-capability.cjs"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /opencodereview|open-code-review|alibaba|\bocr\b/i);
  });

  it("plans a runnable invocation bound to the candidate diff", () => {
    const plan = capability.planReview(spec());
    assert.equal(plan.outcome, "READY");
    assert.ok(Array.isArray(plan.argv) && plan.argv.length > 0);
    assert.ok(plan.argv.includes(BASE), "the plan pins the diff base");
    assert.ok(plan.argv.includes(REV), "the plan pins the candidate revision");
  });

  // A capability that is off is not a gap; one that is required and missing is.
  it("stays inactive when neither enabled nor required", () => {
    const plan = capability.planReview(spec({ enabled: false, required: false }));
    assert.equal(plan.outcome, "INACTIVE");
    assert.equal(plan.reason, "capability_unselected_unrequired");
  });

  it("reports a typed gap when required but unavailable", () => {
    const plan = capability.planReview(spec({ required: true, available: false }));
    assert.equal(plan.outcome, "UNAVAILABLE");
    assert.equal(plan.reason, "typed_capability_gap");
  });

  it("reports a typed gap when enabled but unavailable, never silent equivalence", () => {
    const plan = capability.planReview(spec({ enabled: true, available: false }));
    assert.equal(plan.outcome, "UNAVAILABLE");
    assert.equal(plan.reason, "typed_capability_gap");
  });

  it("freezes first-pass findings under a digest bound to the candidate", () => {
    const f = frozen();
    assert.match(f.digest, /^[0-9a-f]{64}$/);
    assert.equal(f.snapshot.findings.length, 2);
    assert.equal(f.snapshot.candidate_revision, REV);
  });

  it("freezes an empty first pass: finding nothing is a real result", () => {
    const f = capability.freezeFindings({ findings: [], candidate });
    assert.equal(f.outcome, "READY");
    assert.match(f.digest, /^[0-9a-f]{64}$/);
  });

  it("digests only the findings, so key order and list order do not change it", () => {
    const a = capability.freezeFindings({ findings: own, candidate }).digest;
    const reordered = [
      { summary: "dead branch", severity: "P3", line: 4, file: "src/b.js", id: "R-2" },
      { line: 10, file: "src/a.js", id: "R-1", summary: "unchecked index", severity: "P1" },
    ];
    assert.equal(capability.freezeFindings({ findings: reordered, candidate }).digest, a);
  });

  it("changes the digest when a finding changes", () => {
    const a = frozen().digest;
    const b = frozen([{ ...own[0], severity: "P0" }, own[1]]).digest;
    assert.notEqual(a, b);
  });

  it("snapshots by value, so later edits cannot rewrite the frozen set", () => {
    const findings = [{ ...own[0] }];
    const f = capability.freezeFindings({ findings, candidate });
    findings[0].severity = "P0";
    assert.equal(f.snapshot.findings[0].severity, "P1");
  });

  // The anti-anchoring rule: no external findings before the first pass is sealed.
  it("refuses reconciliation when the first pass was never frozen", () => {
    const r = capability.reconcileFindings({ frozen: null, external, candidate });
    assert.equal(r.outcome, "REJECT");
    assert.equal(r.reason, "first_pass_not_frozen");
    assert.equal(r.findings, undefined);
  });

  it("refuses reconciliation when the frozen set does not match its digest", () => {
    const f = frozen();
    const tampered = { ...f, snapshot: { ...f.snapshot, findings: [own[0]] } };
    const r = capability.reconcileFindings({ frozen: tampered, external, candidate });
    assert.equal(r.outcome, "REJECT");
    assert.equal(r.reason, "frozen_findings_digest_mismatch");
  });

  it("refuses a frozen set bound to a different candidate", () => {
    const f = capability.freezeFindings({
      findings: own,
      candidate: { ...candidate, candidate_revision: BASE },
    });
    const r = capability.reconcileFindings({ frozen: f, external, candidate });
    assert.equal(r.outcome, "REJECT");
    assert.equal(r.reason, "candidate_mismatch");
  });

  it("reconciles into one set and preserves provenance", () => {
    const r = capability.reconcileFindings({ frozen: frozen(), external, candidate });
    assert.equal(r.outcome, "READY");
    const by = (file, line) => r.findings.find((f) => f.file === file && f.line === line);
    assert.equal(by("src/a.js", 10).provenance, "both", "same location from both paths");
    assert.equal(by("src/b.js", 4).provenance, "reviewer");
    assert.equal(by("src/c.js", 99).provenance, "capability");
    assert.equal(r.findings.length, 3);
    assert.deepEqual(r.counts, { reviewer: 1, capability: 1, both: 1 });
  });

  // A disagreement is information. Dropping it would hide the second path's value.
  it("surfaces a severity conflict rather than silently picking one", () => {
    const r = capability.reconcileFindings({ frozen: frozen(), external, candidate });
    const shared = r.findings.find((f) => f.provenance === "both");
    assert.equal(shared.severity_conflict, true);
    assert.deepEqual(shared.severities, { reviewer: "P1", capability: "P2" });
    assert.equal(shared.severity, "P1", "the Reviewer's severity stands until adjudicated");
    assert.equal(r.conflicts.length, 1);
  });

  it("records no conflict when both paths agree on severity", () => {
    const agreeing = [{ file: "src/a.js", line: 10, severity: "P1", summary: "same call" }];
    const r = capability.reconcileFindings({ frozen: frozen(), external: agreeing, candidate });
    const shared = r.findings.find((f) => f.provenance === "both");
    assert.equal(shared.severity_conflict, false);
    assert.equal(r.conflicts.length, 0);
  });

  it("reconciles with no external findings at all", () => {
    const r = capability.reconcileFindings({ frozen: frozen(), external: [], candidate });
    assert.equal(r.outcome, "READY");
    assert.equal(r.findings.length, 2);
    assert.ok(r.findings.every((f) => f.provenance === "reviewer"));
  });

  it("keeps the reviewer verdict out of its own hands: it returns findings, not a verdict", () => {
    const r = capability.reconcileFindings({ frozen: frozen(), external, candidate });
    assert.equal(r.verdict, undefined, "the Reviewer owns the verdict, not this module");
    assert.equal(r.gate_eligible, undefined);
  });

  it("marks the capability as a tool, never a role or an authority", () => {
    const plan = capability.planReview(spec());
    assert.equal(plan.capability_is_role, false);
    assert.equal(plan.grants_authority, false);
  });
});

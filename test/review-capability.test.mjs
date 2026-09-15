/**
 * Issue #104: review coverage assist.
 * A deterministic capability the Reviewer uses as its method: which files are
 * reviewable, which are excluded and why, and which rules apply. It finds no
 * defects and produces no verdict. The Reviewer does both.
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
    capability: "coverage-tool",
    candidate,
    declared: { enabled: true, required: false, available: true },
    ...extra,
  };
}

/** A coverage report in the shape such a tool emits. */
function coverage(extra = {}) {
  return {
    mode: "range",
    reviewable_files: [
      { path: "src/a.js", status: "modified", insertions: 12, deletions: 2 },
      { path: "src/b.py", status: "added", insertions: 40, deletions: 0 },
    ],
    excluded_files: [
      { path: "pnpm-lock.yaml", exclude_reason: "unsupported_ext" },
      { path: "assets/logo.png", reason: "binary" },
    ],
    ...extra,
  };
}

describe("review coverage assist (#104)", () => {
  it("never invokes the capability: no child process surface", () => {
    const source = readFileSync(path.join(ROOT, "hooks/review-capability.cjs"), "utf8");
    assert.doesNotMatch(source, /child_process|execSync|spawnSync|\bspawn\(/);
  });

  it("names no specific review tool in its logic", () => {
    const source = readFileSync(path.join(ROOT, "hooks/review-capability.cjs"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /opencodereview|open-code-review|alibaba|\bocr\b/i);
  });

  it("ships as text: the module carries no NUL or non-ASCII byte", () => {
    const bytes = readFileSync(path.join(ROOT, "hooks/review-capability.cjs"));
    assert.equal(bytes.includes(0), false, "a NUL byte makes the file binary to tooling");
    assert.ok(bytes.every((b) => b <= 127), "non-ASCII bytes risk the same misclassification");
  });

  it("plans the coverage call bound to the candidate diff", () => {
    const plan = capability.planCoverage(spec());
    assert.equal(plan.outcome, "READY");
    assert.ok(plan.argv.includes(BASE), "pins the diff base");
    assert.ok(plan.argv.includes(REV), "pins the candidate revision");
    assert.ok(plan.argv.includes("--format") && plan.argv.includes("json"));
  });

  it("passes a repository ruleset override through when one is declared", () => {
    const plan = capability.planCoverage(spec({ rule_file: "ocr-rules.json" }));
    assert.ok(plan.argv.includes("--rule"));
    assert.ok(plan.argv.includes("ocr-rules.json"));
  });

  // The parent controller resolves availability once and states it in the
  // packet. The Reviewer must never spend a turn discovering it.
  it("requires availability to be declared, never discovered", () => {
    const plan = capability.planCoverage(spec({ declared: { enabled: true, required: false } }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "capability_not_declared");
  });

  it("rejects a declaration that is not a complete statement", () => {
    const plan = capability.planCoverage(spec({ declared: undefined }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "capability_not_declared");
  });

  it("stays inactive when neither enabled nor required", () => {
    const plan = capability.planCoverage(
      spec({ declared: { enabled: false, required: false, available: true } }),
    );
    assert.equal(plan.outcome, "INACTIVE");
    assert.equal(plan.reason, "capability_unselected_unrequired");
  });

  it("reports a typed gap when activated but unavailable", () => {
    for (const declared of [
      { enabled: true, required: false, available: false },
      { enabled: false, required: true, available: false },
    ]) {
      const plan = capability.planCoverage(spec({ declared }));
      assert.equal(plan.outcome, "UNAVAILABLE");
      assert.equal(plan.reason, "typed_capability_gap");
    }
  });

  it("requires a candidate bound to a diff base", () => {
    const plan = capability.planCoverage(spec({ candidate: { candidate_ref: "c", candidate_revision: REV } }));
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "diff_base_unbound");
  });

  it("plans the rule call for exactly the reviewable paths", () => {
    const plan = capability.planRules({ plan: capability.planCoverage(spec()), coverage: coverage() });
    assert.equal(plan.outcome, "READY");
    assert.ok(plan.argv.includes("src/a.js"));
    assert.ok(plan.argv.includes("src/b.py"));
    assert.equal(plan.argv.includes("pnpm-lock.yaml"), false, "excluded paths are not sent");
  });

  it("stays inactive for rules when nothing is reviewable", () => {
    const plan = capability.planRules({
      plan: capability.planCoverage(spec()),
      coverage: coverage({ reviewable_files: [] }),
    });
    assert.equal(plan.outcome, "INACTIVE");
    assert.equal(plan.reason, "no_reviewable_files");
  });

  it("refuses to plan rules without a prior coverage plan", () => {
    const plan = capability.planRules({ plan: null, coverage: coverage() });
    assert.equal(plan.outcome, "NEEDS_MORE_EVIDENCE");
    assert.equal(plan.reason, "coverage_plan_missing");
  });

  // The Reviewer reviews the candidate, not the tool's file list. An exclusion
  // it never sees is an exclusion it cannot overrule.
  it("summarizes coverage so exclusions stay visible to the Reviewer", () => {
    const s = capability.summarizeCoverage({ coverage: coverage(), candidate });
    assert.equal(s.outcome, "READY");
    assert.equal(s.reviewable_count, 2);
    assert.equal(s.excluded_count, 2);
    assert.deepEqual(s.excluded, [
      { path: "pnpm-lock.yaml", reason: "unsupported_ext" },
      { path: "assets/logo.png", reason: "binary" },
    ]);
    assert.equal(s.candidate_revision, REV);
  });

  it("flags an exclusion reason the Reviewer should not take on trust", () => {
    const s = capability.summarizeCoverage({
      coverage: coverage({
        excluded_files: [{ path: "skills/reviewer/SKILL.md", exclude_reason: "unsupported_ext" }],
      }),
      candidate,
    });
    assert.equal(s.excluded_count, 1);
    assert.equal(s.excluded[0].reason, "unsupported_ext", "the reason is read, not dropped");
    assert.equal(s.coverage_is_advisory, true, "the file list never binds the Reviewer");
  });

  it("reads an unexplained exclusion as unstated rather than inventing one", () => {
    const s = capability.summarizeCoverage({
      coverage: coverage({ excluded_files: [{ path: "x.bin" }] }),
      candidate,
    });
    assert.equal(s.excluded[0].reason, "unstated");
  });

  it("returns findings from no one: coverage assist produces no defects", () => {
    const s = capability.summarizeCoverage({ coverage: coverage(), candidate });
    assert.equal(s.findings, undefined);
    assert.equal(s.verdict, undefined);
    assert.equal(s.gate_eligible, undefined);
  });

  it("marks the capability as a tool, never a role or an authority", () => {
    const plan = capability.planCoverage(spec());
    assert.equal(plan.capability_is_role, false);
    assert.equal(plan.grants_authority, false);
  });
});

"use strict";

/**
 * Review coverage assist (issue #104).
 *
 * A Reviewer's coverage, file selection, and review order are all mediated by
 * one session, so it can miss a file or apply the wrong lens to one. A
 * deterministic capability fixes that half cheaply: it says which files are
 * reviewable, which are excluded and why, and which rules apply to each.
 *
 * It finds no defects and returns no verdict. The Reviewer does both. This is
 * the Reviewer's method, not a second opinion, so there is no separate findings
 * set, nothing to anchor on, and nothing to reconcile.
 *
 * Availability is declared, never discovered. The parent controller resolves it
 * once and states it in the packet; a Reviewer that probes spends a turn on
 * plumbing before reviewing anything, which is the cost this capability exists
 * to avoid.
 *
 * Pure evaluator: no HOOK_CLASS, no host event, no download, no process
 * execution. The caller runs the planned command. The capability is a tool. It
 * is never a role, never an authority, and its file list never binds the
 * Reviewer: an exclusion is advisory, and the Reviewer may overrule it.
 */

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonempty = (value) => typeof value === "string" && value.length > 0;

function fail(outcome, reason, extra = {}) {
  return { outcome, reason, ...extra };
}

function candidateBound(candidate) {
  return (
    isPlainObject(candidate) &&
    nonempty(candidate.candidate_ref) &&
    nonempty(candidate.candidate_revision)
  );
}

/**
 * A declaration is a complete statement of all three states. A missing field
 * means the parent controller did not resolve it, which is not the Reviewer's
 * job to finish.
 */
function declarationOf(spec) {
  const declared = spec.declared;
  if (
    !isPlainObject(declared) ||
    typeof declared.enabled !== "boolean" ||
    typeof declared.required !== "boolean" ||
    typeof declared.available !== "boolean"
  ) {
    return null;
  }
  return declared;
}

/**
 * Plan the coverage call: which files are reviewable for this candidate.
 * Nothing is executed here.
 *
 * @param {{
 *   capability?: string, candidate?: object, rule_file?: string,
 *   declared?: {enabled: boolean, required: boolean, available: boolean},
 *   exclude?: string, args?: string[]
 * }} [spec]
 * @returns {{outcome: string, reason?: string, argv?: string[]}}
 */
function planCoverage(spec) {
  if (!isPlainObject(spec)) return fail("NEEDS_MORE_EVIDENCE", "review_spec_missing");
  if (!nonempty(spec.capability)) return fail("NEEDS_MORE_EVIDENCE", "capability_unspecified");

  const declared = declarationOf(spec);
  if (declared === null) return fail("NEEDS_MORE_EVIDENCE", "capability_not_declared");

  // An explicit "off" is a real choice, not a gap.
  if (!declared.enabled && !declared.required) {
    return fail("INACTIVE", "capability_unselected_unrequired");
  }
  // Activated but missing is a typed gap. Never report equivalent coverage.
  if (!declared.available) return fail("UNAVAILABLE", "typed_capability_gap");

  const candidate = spec.candidate;
  if (!candidateBound(candidate)) return fail("NEEDS_MORE_EVIDENCE", "candidate_unbound");
  if (!nonempty(candidate.diff_base)) return fail("NEEDS_MORE_EVIDENCE", "diff_base_unbound");

  const argv = [
    spec.capability,
    "delegate",
    "preview",
    "--format",
    "json",
    "--from",
    candidate.diff_base,
    "--to",
    candidate.candidate_revision,
  ];
  // A repository whose own file types fall outside the default ruleset supplies
  // its own, rather than accepting a list that skips what matters most to it.
  if (nonempty(spec.rule_file)) argv.push("--rule", spec.rule_file);
  if (nonempty(spec.exclude)) argv.push("--exclude", spec.exclude);
  if (Array.isArray(spec.args)) argv.push(...spec.args.map(String));

  return {
    outcome: "READY",
    argv,
    capability: spec.capability,
    candidate_ref: candidate.candidate_ref,
    candidate_revision: candidate.candidate_revision,
    rule_file: nonempty(spec.rule_file) ? spec.rule_file : undefined,
    capability_is_role: false,
    grants_authority: false,
  };
}

function reviewablePaths(report) {
  const files = isPlainObject(report) ? report.reviewable_files : null;
  if (!Array.isArray(files)) return null;
  const paths = [];
  for (const file of files) {
    if (!isPlainObject(file) || !nonempty(file.path)) return null;
    paths.push(file.path);
  }
  return paths;
}

/**
 * Plan the rule call for exactly the reviewable paths the coverage report named.
 *
 * @param {{plan?: object, coverage?: object}} [input]
 * @returns {{outcome: string, reason?: string, argv?: string[]}}
 */
function planRules(input) {
  if (!isPlainObject(input)) return fail("NEEDS_MORE_EVIDENCE", "rule_input_missing");

  const plan = input.plan;
  if (!isPlainObject(plan) || plan.outcome !== "READY" || !nonempty(plan.capability)) {
    return fail("NEEDS_MORE_EVIDENCE", "coverage_plan_missing");
  }

  const paths = reviewablePaths(input.coverage);
  if (paths === null) return fail("NEEDS_MORE_EVIDENCE", "coverage_report_unreadable");
  if (paths.length === 0) return fail("INACTIVE", "no_reviewable_files");

  const argv = [plan.capability, "delegate", "rule", "--format", "json", ...paths];
  if (nonempty(plan.rule_file)) argv.splice(5, 0, "--rule", plan.rule_file);

  return { outcome: "READY", argv, paths };
}

/**
 * Put the coverage decision in front of the Reviewer, exclusions included.
 * A file the Reviewer never learns was skipped is one it cannot decide to read.
 *
 * @param {{coverage?: object, candidate?: object}} [input]
 * @returns {{outcome: string, reason?: string}}
 */
function summarizeCoverage(input) {
  if (!isPlainObject(input)) return fail("NEEDS_MORE_EVIDENCE", "summary_input_missing");
  if (!candidateBound(input.candidate)) return fail("NEEDS_MORE_EVIDENCE", "candidate_unbound");

  const report = input.coverage;
  const paths = reviewablePaths(report);
  if (paths === null) return fail("NEEDS_MORE_EVIDENCE", "coverage_report_unreadable");

  const rawExcluded = Array.isArray(report.excluded_files) ? report.excluded_files : [];
  const excluded = [];
  for (const file of rawExcluded) {
    if (!isPlainObject(file) || !nonempty(file.path)) {
      return fail("NEEDS_MORE_EVIDENCE", "coverage_report_unreadable");
    }
    // Tools spell this differently; take whichever the report carries rather
    // than silently reporting every exclusion as unexplained.
    const reason = nonempty(file.exclude_reason)
      ? file.exclude_reason
      : nonempty(file.reason)
        ? file.reason
        : "unstated";
    excluded.push({ path: file.path, reason });
  }

  return {
    outcome: "READY",
    candidate_ref: input.candidate.candidate_ref,
    candidate_revision: input.candidate.candidate_revision,
    mode: nonempty(report.mode) ? report.mode : "unstated",
    reviewable: paths,
    reviewable_count: paths.length,
    excluded,
    excluded_count: excluded.length,
    // The Reviewer owns what it reads. This list informs that choice, it does
    // not make it.
    coverage_is_advisory: true,
  };
}

module.exports = {
  planCoverage,
  planRules,
  summarizeCoverage,
};

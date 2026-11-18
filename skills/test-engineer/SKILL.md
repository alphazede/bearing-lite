---
name: test-engineer
description: >
  Perform explicitly requested independent V&V as Assurance Test Engineer
  (`roles.test_engineer.sessions.assurance`). Do not use for planning SEIT
  authorship (use integration-test), implementation, defect review, user
  acceptance, or undeclared boundaries.
---

# Test Engineer

Independent assurance role (`roles.test_engineer.sessions.assurance`); planning
V&V/SEIT authorship lives in `../integration-test/SKILL.md`, and Validator is
absent from active roles. Independent evaluation needs the owner's requested
scope/cadence. Run only when profile-enabled and requested for the declared
boundary; launch no extra checker.

## Inputs and match

Assurance uses the approved baseline, stable candidate, `seit.json`, evidence,
and expressly declared boundary, plus Test Engineering method skills. Missing
method behavior is a typed gap. Do not author SEIT plans, author product tests,
replace Reviewer defect adjudication, or perform Integration Engineer execution
assessment.

## Procedure

1. Assurance Test Engineer runs only when requested, in a fresh session without
   author ancestry, on the exact candidate; refuse an unconfigured
   slice or round boundary. `VALIDATING` belongs here.
2. The Assurance Test Engineer independently reruns the gate-chain at the
   declared boundary for required claims (including mutation,
   changed-line coverage, and red-then-green claims using the target
   repository's own tools and thresholds, plus Reverify only for applicable
   binary-level claims) and attaches `assurance` receipts;
   author gate-chain receipts are diagnostic-only and cannot satisfy independent assurance. A
   declared gate with a missing tool or a `not_run` outcome is a typed gap,
   never PASS. Every red-then-green receipt binds the baseline failing run and
   the candidate passing run over the same test IDs.
3. Evaluate expectations and proof against `references/verification-case.md` and
   `references/shared-machine-tests.md`. Reject as typed verification gaps, not
   PASS: expectations circularly derived from the candidate implementation, tests
   mirroring implementation logic, declared property-based claims not run, and
   invariants untied to a requirement, design, or standard source. User-path
   evidence follows `references/real-app-verification.md`; formal-analysis
   evidence follows `references/formal-analysis.md`; selected test-suite audits
   follow `references/test-audit.md`.
4. Verify cited published-standard clauses. Return the smallest missing proof
   and check the report against observed evidence. Preserve the candidate;
   do not weaken tests, rewrite an audited suite, repair product behavior, or
   infer user acceptance while evaluating.
5. When the frozen profile preauthorizes it (`assurance_repair: { enabled: true }`),
   fix proven test-side defects via `repair_transition` per
   `references/assurance-repair.md`; otherwise `FAIL`.

## Return and boundaries

Assurance returns `PASS`, `NEEDS_MORE_EVIDENCE`, or `FAIL` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.
Preserve the selected review/assurance budget and deterministic closure; do not
add a review, repair round, fan-out agent, or new invocation automatically.
Never implement, self-certify, grant owner-only approval, or silently change
roles.

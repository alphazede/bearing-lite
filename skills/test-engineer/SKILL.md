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
and expressly declared boundary, plus Test Engineering method skills. Packets
name the verified Git object for tracked inputs and keep the exact author draft
through assurance so verification reads direct evidence rather than
reconstructed history. Missing
method behavior is a typed gap. Do not author SEIT plans, author product tests,
replace Reviewer defect adjudication, or perform Integration Engineer execution
assessment.

## Procedure

1. Assurance Test Engineer runs only when requested, in a fresh session without
   author ancestry, on the exact candidate; refuse an unconfigured
   slice or round boundary. `VALIDATING` belongs here. For a multi-slice
   declared phase or wave, independent assurance may start on finished slices'
   immutable receipts and the pinned candidate while the last slice runs.
   In the same session, join the last slice's receipts before issuing its
   verdict on the final integrated candidate. Credit early evidence only
   when its verified inputs and claims still apply to that candidate. Keep
   single-run role and gate budgets by independently validating the single-run
   receipt as described below. A live-host phase
   classified per operation (not by a whole-phase label) where every planned
   operation is a copy or a read resolves to `standard` with a before and after
   live-service observation, one implementer, one review, and no separate
   assurance (`../bearing-lite/references/verification.md#process-tier-resolution`);
   phases with any other operation, or that delete or mutate, retain their prior
   tier and resolve as before.
2. By default, the Assurance Test Engineer independently reruns the gate-chain
   at the declared boundary for required claims and attaches `assurance` receipts.
   Author gate-chain receipts are diagnostic evidence. Use the target repository's
   tools and thresholds for mutation, changed-line coverage, and red-then-green
   claims. Apply Reverify only to applicable binary-level claims.

   For a declared gate or role turn with an explicit **one-run budget**, use
   **independent validation of a single-run receipt**. Verify the recorded
   inputs, digest, and retained log against the exact candidate, command, and
   pass/fail rule. Cite the original run in the independent assurance receipt
   and record your verdict there.

   A missing tool or a `not_run` outcome for a declared gate is a typed gap.
   Every red-then-green receipt binds the baseline failing run and the
   candidate passing run over the same test IDs.
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
candidate_ref, changed_paths, tests, findings, and blocker. Evidence returns
digests, commands, and exit codes, not narrative logs. Honor the packet's time
target; at the limit, return what you have and list the gaps.
Preserve the selected review/assurance budget and deterministic closure; do not
add a review, repair round, fan-out agent, or new invocation automatically.
Never implement, self-certify, grant owner-only approval, or silently change
roles.

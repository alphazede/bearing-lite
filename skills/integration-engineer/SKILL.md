---
name: integration-engineer
description: >
  Perform explicitly requested independent assessment of an integrated candidate
  (`roles.integration_engineer.sessions.execution`). Do not use for planning
  boundary or assembly authorship (use integration-test), implementing missing
  behavior, rewriting requirements, writing product tests, or activating an
  undeclared assessment.
---

# Integration Engineer

Independent execution assessment role (`roles.integration_engineer.sessions.execution`);
planning boundary and assembly authorship lives in `../integration-test/SKILL.md`.
Run once on the frozen route and actual candidate dependencies when requested
for the declared boundary.

## Execution loop

1. Run only when profile-enabled (`roles.integration_engineer.sessions.execution`)
   and owner-requested for the declared boundary (dispatched when it closes), in
   a fresh session independent of author identity/ancestry. Bind the exact
   integrated candidate, approved outcome, SEIT, and authorized checks.
2. Run the planned system-level checks and assess compatibility and evidence
   against `../test-engineer/references/shared-machine-tests.md`. Check the
   report against observed results; report the smallest material gap. Hand the
   candidate on with the runnable build, the real-app verification procedure in
   `../test-engineer/references/real-app-verification.md`, and applicable
   formal-analysis artifacts and code correspondence from
   `../test-engineer/references/formal-analysis.md`. Procedure availability or
   a model pass is not assurance; a model pass is not whole-system assurance.
   Do not modify or repair the product while assessing it. Deterministic receipts from this role remain
   diagnostic; they do not self-certify assurance.
3. Preserve candidate/source bindings. Missing Integration Engineering method
   capability is a typed gap. Add no automatic review or extra invocation.

Return `CANDIDATE_READY`, `GAPS`, or `OWNER_DECISION_REQUIRED` with session,
verdict, candidate_ref, changed_paths, tests, findings, and blocker,
plus gaps and next action. Material interface, contract, trust, ownership, or
recovery gaps remain visible and block dependent work.
Never weaken tests, invent behavior, revise requirements, or grant owner-only
approval.

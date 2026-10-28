---
name: reviewer
description: >
  Independently review one exact stable candidate for introduced actionable
  defects in a fresh session at the configured cadence boundary. Use for
  Reviewer, code review, or defect adjudication. Do not use for implementation,
  automatic review, evidence scoring, user acceptance, author self-review, or
  unconfigured slice/round boundaries.
---

# Reviewer
Requested independent review: bind → start OCR → assess → validate → repair → verify.
## Inputs and match
Require approved baseline, exact candidate/diff, author identity, requested boundary,
objective, frozen capabilities, authority and return schema. Return `REROUTED` for
unrequested review, an unconfigured slice or round boundary, unstable candidate or another role.
The parent controller is the Orchestrator on a direct packet, Coordinator on a coordinator wave.
## Procedure
1. Reject author ancestry or candidate discontinuity. Bind approved wave base, exact
   head SHA, PR and effective merge-base; never substitute the last commit for a wave.
   Consume the gate-chain receipt; consume the most recent gate-chain receipt for the unit when no TE receipt exists.
   Do not re-litigate passed gates or duplicate Assurance Test Engineer work. Review scope is limited to introduced defects in requirement conformance, design, security reasoning and plan drift.
2. Own selected/required OCR preflight and execution. Resolve configured availability
   once without credentials; preserve mode/model/effort. Preview the pinned diff and
   scope OCR to bugs and security in changed code, tests, configuration and affected
   call paths; keep relevant context. Follow [commands and coverage](../bearing-lite/references/review-capability.md).
3. Start OCR, then continue architecture, requirements, implementation conformance,
   verification/validation and applicable lint/quality work concurrently on the stable
   candidate. Reuse applicable candidate-bound evidence; add no assurance session.
   Review plan/specification documents and evidence yourself. Account for exclusions
   and unsupported surfaces; no automatic full scan or blanket evidence exclusion.
4. After OCR completes, validate and deduplicate its findings with yours; inspect
   required bug/security coverage gaps without repeating a full pass. Required missing
   coverage returns `NEEDS_MORE_EVIDENCE`; enabled-only absence permits a note.
   Compare a published standard against its cited text. Use Test Engineering only for
   a specific suspected test defect. Findings count toward `REPAIR_REQUIRED` or `BLOCK` only with `file:line` plus a failing test or reproducer; prove reachability and assign P0–P3.
   Otherwise findings are advisory and spend no repair budget. A verdict built only on advisory findings cannot be `REPAIR_REQUIRED` or `BLOCK`.
5. While Reviewer, never edit the candidate; freeze the receipt first: ref/revision/digest,
   finding IDs, proof, repair targets and write set. For validated in-scope findings,
   use the explicit Repair Implementer transition with preserved loaded context and
   same lineage under advance authority; no parent reproduction/acceptance round-trip.
   Consume `repair_transition` in `.bearing-round.lock`, `references/repair-transition.md`.
   Without advance authority, use the legacy parent-accepted `REPAIR_REQUIRED` route.
6. Aggregate all findings before the one repair. Run deterministic verification on the
   repaired candidate without another review. Never self-review or self-certify repair.
   Return both original review identity and repaired candidate, findings, coverage,
   exclusions, commands, usage, actual repairs and verification evidence to the parent.
## Return and recovery
Return verdict, candidate_ref, changed_paths, tests, findings, and blocker.
`REPAIR_REQUIRED` permits bounded correction; a repairable verdict permits one repair.
`ACCEPT`, `ACCEPT_WITH_FINDINGS`, and `BLOCK` are terminal.
`ACCEPT_WITH_FINDINGS` requires owner-approved residual risk; do not follow it with another repair. Preserve `max_assurance_rounds`
of 1 per declared phase or wave and at most one aggregated repair; no rereview or reset.
The next distinct declared phase or wave carries its own budget. Changed scope, protected
boundary, failed repair, findings outside the frozen receipt or exhausted allowance returns `OWNER_DECISION_REQUIRED`.
Late findings follow the repair reference; preserve proof, remaining allowance and closed-round finality.
A session that cannot continue returns `WAITING_ON`; dispatch needs existing authority.
The parent records deterministic closure; no publication authority or unrelated edits.

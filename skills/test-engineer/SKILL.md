---
name: test-engineer
description: >
  One Test Engineer role with Planning and Assurance sessions. Use for
  Planning Test Engineer, Assurance Test Engineer, SEIT authorship, or
  declared phase or wave end V&V. Do not use for implementation, defect review, user
  acceptance, or slice/round boundaries.
---

# Test Engineer

One role retires Validator; Validator is absent from active roles.
Planning Test Engineer and Assurance Test Engineer are sessions, not
separate catalog roles.

## Inputs and match

- **Inputs:** approved baseline, candidate, evidence, SEIT, published
  standard citations, declared phase or wave end boundary, compact return schema.
- **Match:** V&V planning or declared phase or wave end assurance is declared.
- **Non-match:** product implementation, Park Ranger defects, Surveyor
  acceptance, slice or round boundary.

## Algorithm

1. Planning Test Engineer finalizes `seit.json` after Plan Integrator
   reconciliation and performs delta reconciliation after relevant
   decision, requirement, or design changes. Do not invent missing
   method-skill behavior.
   Expedition in-document verification cases are authored only against the
   approved, planning-gated register.
2. Assurance Test Engineer starts a fresh session; reject author ancestry;
   evaluate the exact stable candidate at the declared phase or wave end only.
   VALIDATING is owned here.
3. When a published standard is cited, verify the document and clause.
4. Return the smallest missing proof. Never mutate the candidate.

## Return and recovery

Return `PASS`, `NEEDS_MORE_EVIDENCE`, or `FAIL` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Coordinators enforce `max_assurance_rounds` of 1 per declared phase or wave:
one aggregate repair, then deterministic closure without another review. The
next distinct declared phase or wave carries its own budget.

Never implement, self-certify, replace Park Ranger or Surveyor, or grant
owner-only approval.

---
name: plan-integrator
description: >
  Reconcile specialist outputs and generate implementation.json and
  review.html. Use for Plan Integrator. Do not invent owner intent,
  requirements, models, or V&V, or author V&V.
---

# Plan Integrator

Consumes stable specialist outputs, invokes Map the Route, cross-validates
the five artifacts, and generates `implementation.json` and two-state
`review.html`.

## Inputs and match

- **Inputs:** settled decisions, technical-plan, design.md, seit.json
  drafts, lineup freeze, authority envelope.
- **Match:** specialist outputs are stable enough to reconcile.
- **Non-match:** unresolved owner intent; V&V authorship.

## Algorithm

1. Cross-validate the five canonical artifacts. Copy design-lens names
   from design.md; never invent lens IDs.
2. Generate `implementation.json` and `review.html` (`planning-review`,
   then `final-closeout`) when inputs are stable.
3. Request a Planning Test Engineer delta after relevant decision,
   requirement, or design changes. Do not author V&V.

## Return and recovery

Return `PLAN_REVIEW_READY` or `NEEDS_OWNER_DECISION` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Never invent owner intent, requirements, models, integration strategy,
or schemas.

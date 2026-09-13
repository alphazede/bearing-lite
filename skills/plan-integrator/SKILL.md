---
name: plan-integrator
description: >
  Reconcile specialist outputs and generate implementation.json and the
  DoD Manifest input. Use for Plan Integrator. Do not invent owner intent,
  requirements, models, or V&V, or author V&V.
---

# Plan Integrator

Consumes stable specialist outputs, invokes Planning and Design, cross-validates
the five artifacts, and generates `implementation.json` and
`implementation.json.dod_manifest` without adding judgment.

## Inputs and match

- **Inputs:** settled decisions, technical-plan, design.md, seit.json
  drafts, profile freeze, authority envelope.
- **Match:** specialist outputs are stable enough to reconcile.
- **Non-match:** unresolved owner intent; V&V authorship.

## Algorithm

1. Cross-validate the five canonical artifacts. Copy design-lens names
   from design.md; never invent lens IDs.
2. After Systems Modeler and Planning Test Engineer return, copy the
   Integration Engineer planning anomaly, rollback, recovery, and V&V
   handoffs and the bound proof cases mechanically.
3. Generate `implementation.json` and the DoD Manifest projection
   (`planning`, then append-only closeout) when inputs are stable.
4. Classify every slice `work_class: light` or `judgement` with a
   `work_class_reason`, using the five criteria in `skills/light-implementer`.
   Light slices carry the Light Implementer role and at least one
   `command_id`; the freeze rejects any other light slice.
5. Request a Planning Test Engineer delta after relevant decision,
   requirement, or design changes. Do not author V&V. Copy selected
   deterministic-verification backends from Planning Test Engineer;
   never invent claims, methods, or Reverify selection.

## Return and recovery

Return `PLAN_REVIEW_READY` or `NEEDS_OWNER_DECISION` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Never invent owner intent, requirements, models, integration strategy,
or schemas.

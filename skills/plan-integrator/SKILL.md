---
name: plan-integrator
description: >
  Planning dispatcher: run planning sessions in order, reconcile outputs, generate
  implementation.json and DoD Manifest input. Use for Plan Integrator or Planning
  and Design dispatch. Do not author sections, resolve conflicts, or author V&V.
---

# Plan Integrator

Planning counterpart of the Coordinator. The planning Orchestrator dispatches it
once (`BEARING_ROLE=plan_integrator`) and waits; it does not relay between
planning roles. This role dispatches the planning sessions, cross-validates the
five artifacts, and generates `implementation.json` and its `dod_manifest`
without adding judgment.

## Inputs and match

- **Inputs:** settled decisions, workspace.md, artifact status, frozen profile,
  authority envelope, return schema; then each session's typed return.
- **Match:** settled intent with a missing planning package or a named delta.
- **Non-match:** unresolved owner intent (`REROUTE_SCOPE_DEFINITION`);
  V&V authorship; execution waves (Coordinator).

## Algorithm

1. Dispatch in order, each a separate session on its frozen route with
   `BEARING_ROLE` set; a needed route that is omitted or disabled is a typed
   capability gap, never substitution:
   1. Systems Modeler contextual pass, when selected or required.
   2. Planning and Design (`BEARING_ROLE=planning_and_design`, frozen
      `plan_integrator` route, never this session): technical plan,
      `design.md`, draft `seit.json`, register rows, proposed graph.
   3. `hooks/register-precheck.cjs`, then Requirements Engineer with its receipt.
   4. Systems Modeler model pass after the Requirements Engineer passes.
   5. Integration Engineer planning session.
   6. Planning Test Engineer finalizes `seit.json` after step 3 reconciles.
2. Send each finding to its owning session as a named delta; never write section
   content or rewrite specialist output. Conflicts return `NEEDS_OWNER_DECISION`.
3. Cross-validate the five canonical artifacts. Copy design-lens names
   from design.md; never invent lens IDs. After Systems Modeler and Planning
   Test Engineer return, copy the Integration Engineer planning anomaly,
   rollback, recovery, and V&V handoffs and the bound proof cases mechanically.
4. When inputs are stable, generate `implementation.json` and the DoD Manifest
   (`planning`, then append-only closeout); `hooks/plan-package.cjs` must PASS.
5. Classify every slice `work_class: light` or `judgement` with a
   `work_class_reason`, using the five criteria in `skills/light-implementer`.
   Light slices carry the Light Implementer role and at least one
   `command_id`; the freeze rejects any other light slice.
6. Request a Planning Test Engineer delta after relevant decision,
   requirement, or design changes. Do not author V&V. Copy selected
   deterministic-verification backends from Planning Test Engineer;
   never invent claims, methods, or Reverify selection.

## Return and recovery

Return `PLAN_REVIEW_READY` or `NEEDS_OWNER_DECISION` with verdict, candidate_ref,
changed_paths, tests, findings, and blocker; the planning Orchestrator then runs
the planning review and owner gate. Never invent owner intent, requirements,
models, integration strategy, or schemas; never author sections or select models.

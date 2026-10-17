---
name: plan-integrator
description: >
  Planning dispatcher: run the planning wave and its one review, reconcile outputs, generate
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

1. Run one planning wave (unit `planning`, reviewer `cadence: phase`, `max_assurance_rounds`
   1 per wave as for implementation waves) per `references/planning-wave.md`: each session
   once, separately, on its frozen route with `BEARING_ROLE` set; an omitted or disabled
   needed route is a typed capability gap, never substitution. Order follows inputs:
   1. Systems Modeler contextual pass, when selected or required.
   2. Planning and Design (`BEARING_ROLE=planning_and_design`, frozen
      `plan_integrator` route, never this session): technical plan,
      `design.md`, draft `seit.json`, register rows, proposed graph.
   3. `hooks/register-precheck.cjs`, then Requirements Engineer with its receipt.
   4. Integration Engineer planning session: Boundary/Data-Flow Contract before design finalizes.
   5. Systems Modeler model pass, when selected or required.
   6. Planning Test Engineer finalizes `seit.json` from the drafts and contract.
   Sessions consume drafts, never verdicts: none waits on a Requirements Engineer pass.
2. Return for the one consolidated review only after every session returns; route
   its one aggregated findings list as one named-delta repair to owning sessions;
   never write section content. Conflicts return `NEEDS_OWNER_DECISION`.
3. Cross-validate the five canonical artifacts; copy design-lens names from design.md,
   never inventing lens IDs. After Systems Modeler and Planning Test Engineer return, copy the
   Integration Engineer anomaly, rollback, recovery, V&V handoffs, `boundary_contract`, and proof cases mechanically.
4. Generate `implementation.json` with `review_rounds` and `planning_wave`, and
   the DoD Manifest (`planning`, then append-only closeout); the draft freeze
   (`plan-package.cjs draft`) must PASS before review, the final freeze after the wave receipt.
5. Classify every slice `work_class: light` or `judgement` with a `work_class_reason`
   per `skills/light-implementer`; light slices carry the Light Implementer role and
   at least one `command_id`; the freeze rejects any other light slice.
6. Do not author V&V. Copy selected deterministic-verification backends from
   Planning Test Engineer; never invent claims, methods, or Reverify selection.

## Return and recovery

Return `PLAN_REVIEW_READY` or `NEEDS_OWNER_DECISION` with verdict, candidate_ref,
changed_paths, tests, findings, and blocker; the planning Orchestrator then runs
the planning review and owner gate. Never invent owner intent, requirements,
models, integration strategy, or schemas; never author sections or select models.

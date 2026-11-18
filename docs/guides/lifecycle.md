# Lifecycle explanation

The Bearing Delivery Lifecycle is one input-to-evidence path. Start with a
Feature Story, Defect, Technical Task, or Change Request. Finish with a
verified candidate, evidence, and a Definition of Done Manifest closeout.

## Forward path

Normal path: Intake → Architectural Alignment and Scope → parallel MBSE and
Integration and Test planning → Orchestrator final Planning and Design and assembly → requested
planning review → owner confirmation → written handoff → implementation.
Only profile-enabled roles the task needs run. The arrows are data
dependencies, not serial barriers: independent ready work runs in parallel.

1. **Intake** names the repository and plan directory.
2. **Architectural Alignment and Scope** runs once in the Orchestrator's
   session: it maps the affected system from repository facts and settles
   material owner decisions one question at a time. There is no separate
   Scope Definition stage.
3. **MBSE** authors and checks requirements and returns view metadata and a
   placement receipt. **Integration and Test** authors the boundary contract,
   assembly strategy, and SEIT. Both start from the same frozen requirement IDs,
   titles, and owner decisions.
4. **Planning and Design** is the Planning Orchestrator's own final step. It
   authors the technical plan and `design.md`, assembles the five-artifact
   package, and checks every allocation and case binding.
5. A **planning review** runs only when the owner asked for one. The owner
   then confirms or changes the package once, and the Orchestrator writes
   `handoff.md`. The approved clean-session setting determines whether
   implementation continues here or in a fresh session.
6. **Implementation** runs Test Implementer first under `tdd`, then the
   Product Implementer; under `single_implementer` one Implementer writes
   code and tests. The Implementation Orchestrator owns new waves. Frozen
   legacy Coordinator work continues on its pinned runtime or after explicit
   handover. Light Implementer takes mechanical slices.
7. **Test Engineer assurance**, **Reviewer**, and **Integration Engineer
    execution** run only when requested, at the configured cadence (defaults
    `phase`, `phase`, `lifecycle`).
8. Closeout appends actuals. Release and deployment stay a separate
    authority.

## What stays out of the path

Specialists own requirements and SEIT meaning. The Planning Orchestrator can
record and apply verified mechanical binding fixes during assembly.
Assurance sessions start fresh and reject author ancestry.
Diagrams and the Manifest explain state; they never authorize a transition.

See the [specification](../architecture/bearing-delivery-lifecycle.md),
the [lifecycle context](../architecture/bearing-process/lifecycle-context.svg),
and the [process views](../architecture/bearing-process/lifecycle-process-views.svg).

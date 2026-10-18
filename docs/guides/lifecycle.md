# Lifecycle explanation

The Bearing Delivery Lifecycle is one input-to-evidence path. Start with a
Feature Story, Defect, Technical Task, or Change Request. Finish with a
verified candidate, evidence, and a Definition of Done Manifest closeout.

## Forward path

Normal path: Intake → Architectural Alignment and Scope → Requirements
Engineer → Systems Modeler → Integration Engineer planning → Planning Test
Engineer → Orchestrator final Planning and Design and assembly → requested
planning review → owner confirmation → written handoff → implementation.
Only profile-enabled roles the task needs run. The arrows are data
dependencies, not serial barriers: independent ready work runs in parallel.

1. **Intake** names the repository and plan directory.
2. **Architectural Alignment and Scope** runs once in the Orchestrator's
   session: it maps the affected system from repository facts and settles
   material owner decisions one question at a time. There is no separate
   Scope Definition stage.
3. **Requirements Engineer** authors requirements from that confirmed context
   and checks and repairs them itself. Later case IDs and placements are
   recorded as pending bindings owned by the Test Engineer and final design.
4. **Systems Modeler** returns a placement receipt from those requirements.
5. **Integration Engineer planning** authors the boundary contract and
   assembly strategy.
6. **Planning Test Engineer** authors SEIT bound to the requirement IDs.
7. **Planning and Design** is the Planning Orchestrator's own final step: it
   authors the technical plan and `design.md`, assembles the five-artifact
   package, and checks every allocation and case binding.
8. A **planning review** runs only when the owner asked for one. The owner
   then confirms or changes the package once, and the Orchestrator writes
   `handoff.md` and recommends a new Implementation Orchestrator session.
9. **Implementation**: under `tdd` the Test Implementer runs before the
   Product Implementer; under `single_implementer` one Implementer writes
   code and tests. Direct packets never dispatch **Coordinator**; the
   Orchestrator is the parent controller. Coordinator continues only when the
   approved graph has a one-wave need. Light Implementer takes mechanical slices.
10. **Test Engineer assurance**, **Reviewer**, and **Integration Engineer
    execution** run only when requested, at the configured cadence (defaults
    `phase`, `phase`, `lifecycle`).
11. Closeout appends actuals. Release and deployment stay a separate
    authority.

## What stays out of the path

The Orchestrator does not author specialist content such as requirements or
SEIT, and it does not invent behavior or decisions. Assurance sessions start
fresh and reject author ancestry.
Diagrams and the Manifest explain state; they never authorize a transition.

See the [specification](../architecture/bearing-delivery-lifecycle.md),
the [lifecycle context](../architecture/bearing-process/lifecycle-context.svg),
and the [process views](../architecture/bearing-process/lifecycle-process-views.svg).

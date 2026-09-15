# Lifecycle explanation

The Bearing Delivery Lifecycle is one input-to-evidence path. Start with a
Feature Story, Defect, Technical Task, or Change Request. Finish with a
verified candidate, evidence, and a Definition of Done Manifest closeout.

## Forward path

1. **Intake** names the repository and plan directory.
2. **Architectural Alignment** maps the affected system from repository
   facts.
3. **Scope Definition** settles material owner decisions.
4. **Planning and Design** produces the five-artifact package.
5. The owner approves or changes that package once.
6. **Implementer** executes bounded slices. Direct packets never dispatch
   **Coordinator**; the Orchestrator is the parent controller. Coordinator
   continues only when the approved graph has a one-wave need. Light
   Implementer takes mechanical slices.
7. **Test Engineer assurance** and **Reviewer** run at the configured
   cadence, default `phase`.
8. **Integration Engineer execution** assesses the integrated result,
   default `lifecycle`.
9. Closeout appends actuals. Release and deployment stay a separate
   authority.

## What stays out of the path

The Orchestrator does not judge technical quality. Plan Integrator does not
invent behavior. Assurance sessions start fresh and reject author ancestry.
Diagrams and the Manifest explain state; they never authorize a transition.

See the [specification](../architecture/bearing-delivery-lifecycle.md),
the [lifecycle context](../architecture/bearing-process/lifecycle-context.svg),
and the [process views](../architecture/bearing-process/lifecycle-process-views.svg).

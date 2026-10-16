# Bearing Delivery Lifecycle

This specification is the public process contract. The README is the concise
onboarding surface. The retained derived views
`docs/architecture/bearing-process/lifecycle-context.svg` and
`docs/architecture/bearing-process/lifecycle-process-views.svg` are
non-normative accessible projections of the same ordered contract; they are
not a SysML model. Modeling stays optional, and native SysML remains the
semantic authority when selected. None of those artifacts grant execution,
acceptance, release, or deployment authority.

## Outcome

A user can start with a Feature Story, Defect, Technical Task, or Change
Request and follow one path:

Intake → Architectural Alignment → Scope Definition → Planning and Design →
owner authorization → bounded implementation → Test Engineer assurance →
Reviewer → Integration Engineer execution assessment → completion evidence.

The generated `<plan-name>-dod-manifest.html` makes planned and actual work
reviewable without becoming execution authority.

## Planning order

1. **Intake** confirms one target repository and plan directory.
2. **Architectural Alignment** creates or resumes `workspace.md` and extracts
   existing architecture covering the affected scope. If none exists or
   evidence does not cover it, record that gap and activate Systems Modeler
   rather than inventing architecture.
3. **Scope Definition** resolves material owner decisions one recommended
   question at a time. Unresolved material intent blocks Planning and Design.
4. The planning Orchestrator dispatches the **Plan Integrator** once. The
   Plan Integrator is the planning counterpart of the Coordinator: it
   dispatches each planning session on its frozen route, sends findings back
   to the owning session as named deltas, and never authors section content
   or resolves a specialist conflict (that returns to the owner). The
   Orchestrator does not relay between planning roles.
5. The Plan Integrator dispatches, in order: the Systems Modeler contextual
   pass when selected or required; **Planning and Design**, which authors
   `<lifecycle-topic>-technical-plan.md`, `design.md`, the draft `seit.json`,
   register rows, and the proposed graph in its own session on the frozen
   `plan_integrator` route; the register pre-check and Requirements Engineer;
   the Systems Modeler model pass; and Integration Engineer planning, which
   owns compatibility, assembly order, interface risk, and integration
   judgments.
6. The Plan Integrator reconciles the five artifacts and copies Integration
   Engineer anomaly, rollback, recovery, and V&V handoffs mechanically; Test
   Engineer planning then finalizes `seit.json`; the Plan Integrator
   generates `implementation.json` and the Definition of Done Manifest input
   and runs the freeze. The write lock refuses planning artifacts written by
   any role other than their bound author, the Coordinator included.
7. Planning uses one initial specialist pass plus at most one targeted
   reconciliation pass. Deterministic mismatches do not consume the targeted
   pass. Remaining material conflict returns to the owner.
8. Planning review is one independent review, at most one aggregated repair,
   deterministic closure, and no automatic rereview. The Orchestrator
   coordinates the transition and never becomes the reviewer.
9. Dispatch starts only after owner authorization of the exact package.

The Orchestrator checks completeness, IDs, dependencies, authority, and
evidence presence only. It does not judge technical quality or
implementation-evidence sufficiency.

## Implementation

`single_implementer` is the speed default: one Implementer writes product
changes plus tests. `tdd` orders Test Implementer before Product Implementer
for a behavior-changing slice. There is no parallel Test Implementer/Product
Implementer mode for one feature. Independent dependency-ready slices may run
concurrently when write sets and mutable resources do not overlap.
`tdd` profiles persist independent `roles.test_implementer` and
`roles.implementer` routes. Planning freezes both. Missing, disabled, or
malformed Test Implementer routes fail closed rather than copying another
role.

Light Implementer executes only `work_class: light` slices. A
`reclassify: judgement` result returns the work to Implementer.

An implementation discovery result that invalidates an approved plan claim
stops dependent work and returns to the human owner. No specialist or
Orchestrator may automatically restart planning or authorize a replacement
plan.

## Roles and sessions

Profiles nest sessions beneath stable role identities.

| Role | Sessions | Default cadence |
|---|---|---|
| Test Engineer | planning and assurance sessions (Planning Test Engineer; Assurance Test Engineer) | assurance: `phase` |
| Integration Engineer | planning and execution sessions | execution: `lifecycle` |
| Reviewer | implementation review | `phase` |
| Systems Modeler | planning | not cadence-gated |

Cadence values are `slice`, `phase`, or `lifecycle`. A declared boundary runs
each enabled session once, allows one aggregated repair, then uses
deterministic closure without automatic rereview. Planning review remains a
separate pre-dispatch gate.

Integration Engineer execution independently performs final system-level
validation and integrated technical assessment against the approved
user-facing outcome, at Lifecycle completion by default or an explicitly
configured `slice`, `phase`, or `lifecycle` boundary. Phase count, increment
count, resume, candidate rename, route change, model change, or session
change is not an override.

## Configuration

`~/.agents/bearing-lite/profiles.json` is the only persistent user
configuration. The shipped `profiles.json` is an empty valid catalog.
`onboard-bearing` asks one setting at a time, including the
planning-to-implementation clean-session boolean, with no preselected value.
Declining Reverify persists `reverify.enabled: false`. A leftover
`lineups.json` returns `MIGRATION_REQUIRED` and is never live data.

When clean-session is enabled, the planning Orchestrator uses the packaged
agnostic prompt skill to render a fresh Orchestrator implementation-start
handoff after exact package approval. When disabled, the existing
Orchestrator continues from the same durable artifacts.

## Resume

Resume reads `journey.json`, `workspace.md`, the active role contract, and
the current task. It performs one host-native liveness check when that
surface exists and classifies `RUNNING`, `COMPLETED`, `INACTIVE`/`EXITED`, or
`UNKNOWN`. It never adds a watchdog daemon, heartbeat service, global
timeout, or model polling, and it never replays accepted planning. `RUNNING`
is never duplicated. `UNKNOWN` without an explicit owner-requested resume
returns `WAITING_ON`. Wait/status reliability varies by host and route.

## Definition of Done Manifest

`implementation.json.dod_manifest` is the structured rendering input. A
Node.js standard-library renderer writes `<plan-name>-dod-manifest.html` with
nine ordered sections, fixed human tables, embedded model views, and
append-only closeout. Closeout preserves approved planning meaning and adds
actual candidate, changed paths, evidence, documentation completion,
anomalies, residual gaps, and acceptance state. The Manifest is a
non-authoritative human projection.

## Authority and stop rules

- Owner Authority remains human-only.
- A candidate author never provides their own Assurance Test Engineer,
  Reviewer, or Integration Engineer execution verdict.
- Scope, interface, security, acceptance, or authority changes stop dependent
  work and return to the owner.
- `COMPLETE` ends Bearing assurance. Release and deployment remain a separate
  owner authority.

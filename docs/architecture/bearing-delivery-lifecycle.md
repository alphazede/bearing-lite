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

Intake → Architectural Alignment and Scope → Requirements Engineer → Systems
Modeler → Integration Engineer planning → Planning Test Engineer → Orchestrator
final Planning and Design and assembly → requested planning review → owner
confirmation → written handoff → bounded implementation → requested assurance
and review → completion evidence.

Only profile-enabled specialists the task needs run. These arrows express input
dependencies; independent ready work runs concurrently. Existing authoritative
artifacts may supply inactive roles' inputs. Missing required deliverables remain
typed gaps, never invented sessions or silent substitutions.

The generated `<plan-name>-dod-manifest.html` makes planned and actual work
reviewable without becoming execution authority.

## Planning order

1. **Intake** confirms one target repository and plan directory.
2. **Architectural Alignment and Scope** runs in the Planning Orchestrator's
   session. It creates or resumes `workspace.md`, maps existing architecture,
   and resolves material owner decisions one question at a time. The legacy
   Scope Definition name forwards here; it is no separate stage or agent.
3. **Requirements Engineer**, when enabled and needed, authors requirements
   and acceptance criteria from confirmed context and source contracts, checks
   their quality, repairs them, and reruns `register-precheck.cjs --stage
   requirements`. Later SEIT case IDs and placement evidence are owned pending
   bindings, not requirements-stage prerequisites.
4. **Systems Modeler**, when enabled and needed, consumes those requirements
   and existing architecture to return model views and placement evidence.
   Missing architecture is a visible gap; it never authorizes another agent.
5. **Integration Engineer planning**, when enabled and needed, authors the
   boundary contract, compatibility and assembly strategy, rollback, recovery,
   and validation steps from requirements, architecture, and proposed interfaces.
6. **Planning Test Engineer**, when enabled and needed, authors `seit.json`
   and proof cases bound to existing requirement IDs using the interface and
   boundary inputs. It completes pending case bindings; it writes no product tests.
7. **Final Planning and Design** is the existing Planning Orchestrator's own
   procedure. It authors the technical plan and `design.md` from completed
   inputs, checks allocations and every case binding with the final-stage
   register precheck and SEIT, then assembles `implementation.json` and the
   Definition of Done Manifest. Requirements and SEIT remain specialist-owned.
8. **Planning review** runs only when the owner requested that boundary and the
   selected Reviewer is enabled. It allows one independent review, at most one
   aggregated repair, deterministic closure, and no automatic rereview. Otherwise
   record `review_requested: false`, zero reviews, and no review receipt.
9. **Owner confirmation and handoff** binds the exact package and execution
   authority. The Orchestrator checks Scribe coverage with `hooks/closeout.cjs`
   and `journey` before writing `handoff.md`, then recommends a new Implementation
   Orchestrator session. It does not launch that session automatically.

Each selected author checks and repairs its output in one assignment. Named
specialist deltas return to that author; additional invocations need their
existing authority. Controllers wait on native completion events and consume
each return once; they never poll logs, processes, status, or worktrees.

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

Cadence values are `slice`, `phase`, or `lifecycle`. Independent review and
assurance run only when the owner requested their scope and cadence; profile
configuration alone never requests them. An authorized boundary runs each
enabled session once, allows one aggregated repair, then uses deterministic
closure without automatic rereview. Planning review has a separate budget.

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

After exact package approval, the Planning Orchestrator writes the handoff and
recommends a fresh Implementation Orchestrator session. The clean-session
setting preserves the owner's session choice; it never authorizes an automatic
launch. Continuing in the current session is an owner choice using the same
durable artifacts. Retired `plan_integrator` and `planning_and_design` routes
return `MIGRATION_REQUIRED`; explicit onboarding removes only the retired key
and preserves every other route and capability without copying its identity.

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

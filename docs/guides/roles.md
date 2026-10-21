# Roles and sessions

Public Bearing Lite uses one role identity with nested sessions where
authority differs.

## Planning

| Role | Responsibility |
|---|---|
| Orchestrator (Planning mode) | Owner conversation, lease, sequencing, specialist dispatch, final plan/design and assembly, requested planning review, handoff |
| Intake | Repository and plan-directory confirmation |
| Architectural Alignment and Scope | Workspace map, architecture extract, and one owner question at a time until shared understanding; runs in the Orchestrator session |
| Requirements Engineer | Authors requirements and runs its own quality pass and repairs |
| Systems Modeler | Modeling mode, prepared views, and placement receipt |
| Integration Engineer (planning) | Plans how components fit together: interfaces, compatibility, assembly order, failure handling, rollback, and validation strategy |
| Test Engineer (planning) | SEIT and proof cases bound to requirement IDs |
| Scribe | Event side lane by its configured cadence; cannot activate authority |

Every specialist is optional and runs only when enabled in the profile and
needed by the task. Scope Definition is a compatibility name for the combined
stage, and final Planning and Design is the Orchestrator's own procedure, not
a dispatched role.

## Implementation and assurance

| Role | Responsibility |
|---|---|
| Orchestrator (Implementation mode) | Consumes the handoff; parent controller and bookkeeper on a direct packet |
| Coordinator | Optional one-wave controller; proven-independent lanes; no nested coordinator. Dispatched only for a one-wave need; never on a direct packet |
| Test Implementer | TDD test-first author (`roles.test_implementer`). Write set is tests and approved fixtures only. Runs before Product Implementer. |
| Product Implementer | Product write set under `tdd` (`roles.implementer`); combined author under `single_implementer`. TDD Product Implementer excludes tests; the combined author owns code and tests. Neither self-certifies. |
| Light Implementer | Mechanical `work_class: light` slices |
| Test Engineer (assurance) | Independent V&V of the exact candidate. Default cadence `phase`. |
| Reviewer | Independent defect review. Default cadence `phase`. |
| Integration Engineer (execution) | Assesses the assembled system against the approved plan and requirements; reports evidence and gaps without repairing product code. Default cadence `lifecycle`. |

Integration Engineer planning and execution are independently configurable:
enable either, both, or neither. Each enabled session has its own harness, model,
reasoning, and ordered fallbacks; execution also has a cadence. Enabling an
assessment session does not itself request that assessment for a task.

Cadence values are `slice`, `phase`, or `lifecycle`. Owner Authority is never
an agent role.

## Terms used during configuration

| Term | Meaning |
| --- | --- |
| SDLC | Software development lifecycle: requirements, planning/design, implementation, verification, and delivery. |
| Profile / agent lineup | Saved choices for roles, sessions, agents, and settings in `profiles.json`. |
| Harness | The application or CLI that runs an agent. |
| Session | One assignment or mode of a role, such as Integration Engineer planning or execution. |
| Slice | One bounded unit of implementation with an outcome, write set, and checks. |
| Wave | Dependency-ready work grouped for coordinated execution and integration. |
| Cadence | The selected boundary for requested review or assessment, such as per slice, phase, or lifecycle. Scribe cadence separately uses event, phase, or lifecycle. |
| TDD | Test-driven development: Test Implementer establishes the failing test before Product Implementer changes behavior. |
| SEIT | The validation plan: methods, proof cases, commands, evidence, and pass/fail criteria. |
| V&V / assurance | Verification and validation check requirements and intended use; assurance evaluates supporting evidence independently when requested. |

See [onboarding](onboarding.md) for how profiles assign routes to these
sessions.

# Roles and sessions

Public Bearing Lite uses one role identity with nested sessions where
authority differs.

## Planning

| Role | Responsibility |
|---|---|
| Orchestrator | Owner conversation, lease, sequencing, structural readiness; parent controller and bookkeeper on a direct packet |
| Intake | Repository and plan-directory confirmation |
| Architectural Alignment | Workspace map and architecture extract |
| Scope Definition | One owner question at a time until shared understanding |
| Requirements Engineer | Requirement quality gate when a register applies |
| Systems Modeler | Modeling mode and prepared views |
| Integration Engineer (planning) | Compatibility, assembly order, rollback, V&V handoffs |
| Test Engineer (planning) | SEIT and proof cases |
| Plan Integrator | Mechanical assembly of agreed outputs |
| Scribe | Event side lane; cannot activate authority |

## Implementation and assurance

| Role | Responsibility |
|---|---|
| Coordinator | Optional one-wave controller; proven-independent lanes; no nested coordinator. Dispatched only for a one-wave need; never on a direct packet |
| Test Implementer | TDD test-first author (`roles.test_implementer`). Write set is tests and approved fixtures only. Runs before Product Implementer. |
| Product Implementer | Product write set under `tdd` (`roles.implementer`); combined author under `single_implementer`. Write set excludes tests. Neither self-certifies. |
| Light Implementer | Mechanical `work_class: light` slices |
| Test Engineer (assurance) | Independent V&V of the exact candidate. Default cadence `phase`. |
| Reviewer | Independent defect review. Default cadence `phase`. |
| Integration Engineer (execution) | Final system-level validation and integrated technical assessment. Default cadence `lifecycle`. |

Cadence values are `slice`, `phase`, or `lifecycle`. Owner Authority is never
an agent role.

See [onboarding](onboarding.md) for how profiles assign routes to these
sessions.

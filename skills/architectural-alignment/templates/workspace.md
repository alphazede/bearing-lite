# Workspace Environment: <lifecycle-title>

## Repository Identity
- Root: `<repository-root>`
- Plan directory: `<plan-directory>`

## Requested Outcome and Scope
- Outcome: `<owner-requested-outcome>`
- Affected flow and boundaries: `<bounded-scope>`

## Mapped Inputs
| Source | What it establishes | Observed revision or content digest |
| --- | --- | --- |
| `<relative-path-or-canonical-source>` | `<observed-fact>` | `<binding>` |

## Observed Systems
- `<relative-directory>`: `<subsystem>`

## Architectural Fit
- Status: `ALIGNED | DECISION_REQUIRED | NEEDS_EVIDENCE`
- Existing components and interfaces: `<source-backed-map>`
- Placement within the existing architecture: `<where-requested-work-belongs>`
- Contracts, data flow, and trust boundaries: `<constraints-and-source-references>`
- Material conflict or architecture change: `<owner-decision-needed-or-none>`
- Evidence gaps and inferences: `<clearly-labelled-gaps-or-none>`

## Confirmed Scope and Decisions
- Shared interpretation: `<owner-confirmed-scope>`
- Confirmation evidence: `<decision-source-or-still-pending>`
- Open, deferred, inapplicable, or blocked items: `<status-and-owner-or-reason>`

Final decision batch (`references/decision-batch.md`); the Requirements Engineer
uses this section as its precheck context before any technical plan exists.

| ID | Confirmed decision | Conditional type |
| --- | --- | --- |
| `DEC-<id>` | `<decision>` | `enforced_rule | expected_outcome | none` |

### Quantity definitions
| Name | Formula | Population and denominator | Units | Source |
| --- | --- | --- | --- | --- |
| `<quantity>` | `<formula>` | `<population, ties/pushes/voids>` | `<units>` | `<field-or-contract>` |

## Constraints and Git Boundaries
- Branch / Worktree: `<branch>` (clean | dirty)
- Rules: `<applicable-rules>`

## Validation Commands [observed, not run]
- Test: `<command>` (source: `<anchor-file>`) [observed, not run]
- Lint: `<command>` (source: `<anchor-file>`) [observed, not run]
- Build: `<command>` (source: `<anchor-file>`) [observed, not run]

## Unknowns
- `<unknown or none observed>`

## Map Freshness
- Observation: `<date-and-current-revision-for-traceability>`
- Recorded root, plan directory, and requested scope match confirmed inputs.
- Source bindings above match current evidence; relevant committed, staged,
  unstaged, and untracked changes were checked: `<evidence>`.
- A clean Git status alone does not establish freshness. Reuse unchanged context;
  refresh affected mappings when relevant sources or requested scope change.

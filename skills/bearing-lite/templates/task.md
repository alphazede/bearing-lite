# Task record template

Use one compact Markdown block per task in the project's existing plan or progress document. Omit unused conditional fields. Prefer the project's format; add only missing fields. Do not create a Bearing-owned state file or hidden ledger.

## Lifecycle settings

Planning and Design records these plan-level proposals above the task blocks in the
complete five-artifact package. The integrated owner review approves or changes
the lifecycle, profile, role states, reasoning, cadence, and plan together; no
pre-planning profile or route-review gate is allowed.

```markdown
- lifecycle: <direct packet | coordinator wave | orchestrated waves>
- review_cadence: phase
- choice_basis: <proposed recommendation and reason; owner-approved at integrated review>
- profile_snapshot: <named implementation/assurance instances plus the planning_review binding below>
- planning_review:
  - policy_ref: skills/bearing-lite/references/review-policy.md
  - candidate_ref: <shared planning-package reference>
  - candidate_revision: <shared planning-package revision>
  - candidate_digest: <shared planning-package digest>
  - reviewer_slots:
    - slot_id: <abstract unique slot>
      primary_route_ref: <owner-selected profile route reference>
      fallback_route_refs: [<ordered owner-selected route references>]
  - round_number: 1
  - completed_rounds: <0-1>
  - receipts: <one isolated receipt per slot, including the distinct selected_route_ref>
  - aggregated_repairs: <0-1>
  - deterministic_gate: <PASS after repair; otherwise omitted>
```

Cadence values are `slice`, `phase`, or `lifecycle` for each declared phase or
wave. Defaults are `phase` for Test Engineer assurance, `phase` for Reviewer,
and `lifecycle` for Integration Engineer execution. The single independent
review runs on that unit's integrated candidate at its declared cadence
boundary, not as task-level tests or author self-checks. Never infer it from
`required_assurance` on an individual task. The proposal is visible in
`implementation.json` and the DoD Manifest, then becomes authoritative only
after the integrated owner approval.
`lifecycle` stays a proposal until the mapped implementation graph exists and
the integrated owner review approves it. `profile_snapshot` is authoritative
after that approval. Later
edits to `~/.agents/bearing-lite/profiles.json` have no effect. The `Orchestrator`
row of the snapshot is the observed identity of the session that ran planning
(harness, model, reasoning at that time); it is never a catalog selection and
never a deviation.
Replace it only through an explicit owner-confirmed dated visible amendment.
Record the amendment date beside the replacement values. Dispatch identities
come from this snapshot, not from the current global defaults file.

Every configured planning-review slot uses the same candidate ref, revision,
and digest. Findings stay isolated until one aggregation. Slot exhaustion is
`FAIL_ROUND`; policy violations halt or require an owner amendment. The binding
does not populate `required_assurance` and does not dispatch reviewers.

## Checkout lease (record before any planning write)

The Orchestrator's first write is this visible lease. Inventory nonterminal Lifecycles
first. Do not dispatch or write other planning state until the lease is
`active` for this Lifecycle.

```markdown
- checkout_lease:
  - journey: <Lifecycle id>
  - controller: <Orchestrator>
  - repository: <canonical repository>
  - checkout: <worktree or checkout identity>
  - branch: <branch>
  - candidate_revision: <candidate revision>
  - acquired_at: <acquisition time>
  - generation: <positive integer>
  - state: <active | released>
```

Same checkout plus a live other Lifecycle returns `WAITING_ON` with sanitized
competing Lifecycle and controller identities. Distinct explicitly approved
compatible worktrees may proceed. Resume keeps the same generation and does
not duplicate dispatch. Authorized same-Lifecycle candidate progress whose
parent is the current leased revision refreshes `candidate_revision` on the
same generation. `COMPLETE` or `CANCELLED` releases the lease exactly
once. Stale recovery is explicit, recorded, increments generation, and cannot
steal a live lease. Process discovery cannot replace this durable lease.

## Wave receipt (record at wave start)

Continuations reuse this visible record beside the checkout lease. Validate at
wave start, after detected drift, and before commit — not before every
mutation. Resume from it; do not reread every accepted artifact or redispatch
completed slices.

```markdown
- wave_receipt:
  - wave: <wave id>
  - lease_generation: <generation>
  - branch: <branch>
  - candidate_revision: <revision at last check>
  - authority: <envelope>
  - checked_at: <wave_start | external_change | commit>
```

Stale, forged, or drifted receipts fail closed. Changed HEAD, authority,
generation, route, or writer overlap forces revalidation or a fresh session.

## Always present

```markdown
### task_id: T1
- outcome: <approved user-visible outcome for this task>
- status: PROPOSED
- assigned_role: <role or unassigned>
- depends_on: []
- next_action: <smallest concrete next step>
```

Field rules:

- `task_id` — stable identifier unique within the plan.
- `outcome` — approved intent for this task only. Never a role-return token and never copied into `verdict`.
- `status` — one of `PROPOSED`, `READY`, `WAITING_ON`, `IN_PROGRESS`, `EVIDENCE_READY`, `VALIDATING`, `REVIEWING`, `ACCEPTANCE`, `CORRECTION_REQUIRED`, `OWNER_DECISION_REQUIRED`, `COMPLETE`, `CANCELLED`.
- `assigned_role` — current role contract for the active step, or unassigned while proposing.
- `depends_on` — list of other `task_id` values only, never prose.
- `next_action` — the immediate allowed step.

## Before execution (add when leaving PROPOSED)

```markdown
- scope: <allowed paths, systems, and boundaries>
- authority: <approved envelope; protected actions remain owner-only>
- required_assurance: [Assurance Test Engineer]
```

`required_assurance` lists only roles that must accept the same candidate (for example `Assurance Test Engineer`, and `Reviewer` or `Integration Engineer execution` when their triggers apply).

The parent controller resolves each declared capability once and states
`enabled`, `required`, and `available` in the packet. A worker never probes for
a capability: discovery spends a turn on plumbing before any work starts, and a
capability the packet does not declare is not used. Declared but unavailable is
a typed capability gap, never silently equivalent coverage.

Test Implementer write set is tests and approved fixtures only. Product
write set excludes tests and must not weaken independently authored tests.
Neither self-certifies.

## After candidate work (add when evidence exists)

```markdown
- candidate_ref: <strongest native revision or changed-path reference available>
- changed_paths: <paths changed in this candidate>
- tests: <commands run and observed results>
- findings: <labeled inferences and gaps>
- verdict: <closed role-return token>
- assurance_rounds: <0-1 completed assurance rounds for this declared phase or wave>
```

`verdict` is one of `ACCEPT`, `ACCEPT_WITH_FINDINGS`, `BLOCK`, `CANDIDATE_READY`, `FAIL`, `GAPS`, `NEEDS_MORE_EVIDENCE`, `OWNER_DECISION_REQUIRED`, `PARTIAL`, `PASS`, `READY`, `REPAIR_REQUIRED`, `REROUTED`, `WAITING_ON`. Do not copy task `outcome` into `verdict`.
`candidate_ref` must not claim stronger provenance than the client can prove.
`assurance_rounds` counts this declared phase or wave's single submission to
required assurance against Bearing Lite `max_assurance_rounds`. A repair or
replacement candidate does not reset it; the next distinct declared phase or
wave carries its own budget. The parent
controller writes the count before dispatch: Orchestrator on a direct packet,
Coordinator on a coordinator wave. If the review permits correction, spend at
most one remaining `attempts` repair, run deterministic parent-controller
verification, and close the gate without another review. A failed repair or
scope change returns `OWNER_DECISION_REQUIRED`.

## Waiting or correcting only

```markdown
- blocker: <WAITING_ON:<task-id> | typed reason | none on success>
- attempts: <0-3 correction attempts for this task or protected action>
```

Omit `blocker` and `attempts` when the task is not waiting or correcting. Waiting does not consume correction attempts.

`COMPLETE` ends Bearing assurance. An already authorized deployment keeps its
own operational checks and rollback evidence but does not reopen independent
review. Any source or candidate change during deployment is separately scoped.

## Single-writer reminder

Only the parent controller updates this block after rereading it. The parent controller is the Orchestrator on a direct packet and the Coordinator on a coordinator wave. Implementer, Test Engineer, Reviewer, and Integration Engineer execution return compact receipts (`verdict`, `candidate_ref`, `changed_paths`, `tests`, `findings`, `blocker`); the parent controller records transitions. Workers do not edit the plan. Implementer must not self-certify. Orchestrator alone changes cross-wave dependencies or global sequencing. Update `implementation.json` and the DoD Manifest once per wave, plus owner-decision or blocker changes. Direct packets never dispatch Coordinator.

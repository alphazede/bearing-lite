---
type: agent-reference
title: Planning Orchestrator Dispatch and Assembly
tags: [bearing, planning]
---

# Planning dispatch and assembly

The Planning Orchestrator owns coordination, final planning/design, and package
assembly in its current session. It keeps research, fact-finding, owner
interviewing, architectural alignment, scope and plan synthesis. Selected
specialists own their inputs. No extra planning controller or final-design
author is needed. Reuse completed work.

## Inputs and ownership

Use confirmed architecture and scope, owner decisions, source bindings, selected
role routes and capabilities, artifact requirements, and declared authority.
Every specialist role is optional. Dispatch only roles explicitly enabled with
a valid route in the selected `profiles.json` binding and needed for this task.
Absent or disabled roles stay inactive; never add them because a lifecycle stage,
hook, or template mentions them. Configuration alone does not request independent
review: the owner must also specify its scope and cadence. Preserve the frozen
selection; later live profile changes require an explicit amendment.
Never copy a route or silently substitute an author. Reuse adequate existing
artifacts when a role is inactive. If a required deliverable lacks an authorized
author or evidence, surface the exact gap for an owner decision. Do not invent
an agent, take over specialist authorship, or label missing work complete.
Retired-role configurations need explicit migration preserving selected identities.

## Planning order

This is the default dependency order, not a requirement to enable every role:

1. **Planning Orchestrator:** confirm Intake, combined Architectural Alignment
   and Scope, the selected profile, required deliverables, and existing evidence.
   At specialist dispatch, freeze the **requirement skeleton (UIDs and titles)**
   and **active decisions**; never amend decisions mid-wave while specialists
   are running—any needed decision change waits for assembly.
2. **`mbse` (`roles.mbse.sessions.planning`) and `integration_test` (`roles.integration_test.sessions.planning`), if enabled and needed — start in parallel:**
   both launch concurrently from the frozen requirement skeleton (UIDs and
   titles), frozen decisions, and confirmed Alignment/Scope context:
   - **`mbse` (`roles.mbse.sessions.planning`):** author full requirement
     statements and acceptance criteria from the confirmed Alignment/Scope
     context and frozen requirement skeleton, running its own quality pass,
     repairs, and recheck (register precheck at `--stage requirements` where
     applicable; later SEIT case IDs are recorded pending bindings, not
     prerequisites for `READY`), and supply the modeling mode, placement receipt
     (current flow, candidate placements with `file:line`, constraints, and
     requirement-to-component mappings), and view metadata with traceability.
   - **`integration_test` (`roles.integration_test.sessions.planning`):** consume
     the frozen requirement skeleton (UIDs and titles), frozen decisions,
     architecture, and proposed interfaces; author `seit.json` (verification
     cases, boundary/data-flow contract, assembly/recovery strategy, integration
     steps and order, validation steps with expected evidence, resource groups,
     expected gate cost, and selected verification claims) bound to the frozen
     requirement UIDs. Do not write product tests.
   Pending cross-artifact bindings are reconciled at assembly; do not serialize
   `mbse` and `integration_test` into sequential specialist gates.
3. **Planning Orchestrator — final Planning and Design:** synthesize the completed
   inputs into the technical plan and `design.md` (keeping **one plan per phase**;
   split multi-phase work into separate phase plans), copy the confirmed quantity
   table into its glossary, allocate against the placement receipt, then assemble
   the implementation graph and Manifest. Validate every required allocation and
   case binding (final-stage `hooks/register-precheck.cjs` with `--seit`) and
   cross-artifact coverage; pending bindings block assembly until completed.
   This final planning step runs in the existing controller, not another agent.
4. **Requested planning review:** after the complete final plan/design and assembly,
   run the profile-enabled Reviewer only when the owner requested review at this
   boundary. Review the exact stable package; address findings only within the
   authorized repair allowance and rerun affected deterministic checks.
   Otherwise record planning review as not requested; do not add a reviewer.
5. **Owner confirmation and handoff:** obtain the execution authority required
   for the exact package, complete its declared final checks, write `handoff.md`,
   and recommend a new Implementation Orchestrator session.

Skip inactive roles without creating substitute sessions. Record actual input
dependencies: independent work may run in parallel once its inputs exist, while
dependent work waits. Do not serialize unrelated work merely to follow numbering.
Missing new architecture or a circular dependency is a visible planning gap,
not authority for extra passes or speculative drafts. Reuse current approved
outputs and record every deliberate departure from this dependency order.

## Event-driven coordination

Subscribe to the selected harness's completion/response notifications when
launching an authorized agent. Wait until a response wakes the controller;
consume that response once and immediately schedule any newly ready independent
work. Do not poll logs, processes, agent status, or worktrees, and do not emulate
notifications with timer loops. If notification/wait support is unavailable,
record `WAITING_ON` with the owned assignment and resume on its actual return.
After a disconnected session, one liveness check may recover its state; it is
not permission to start repeated polling or duplicate an invocation.

## Implementation order after the handoff

1. The Implementation Orchestrator consumes the approved handoff, validates its
   candidate and authority, executes the frozen plan without redoing planning,
   and schedules dependency-ready implementation slices. The pace rules are in
   `coordinator-migration.md`.
2. In selected `tdd` mode, the configured Test Implementer writes the authorized
   tests and records the expected baseline failure before Product Implementer runs.
3. Product Implementer writes the behavior against those tests. In selected
   `single_implementer` mode, the configured Implementer owns both tests and product
   changes; do not create a separate Test Implementer assignment automatically.
4. Run the required deterministic checks. When each declared boundary passes them,
   dispatch the independent review/assurance the owner requested for it in the frozen
   plan at once, without a second request or deferral to a later boundary. Then land
   the closed unit (`task-state.md#landing-a-closed-unit`) and close out the work.

Test planning belongs to planning; test implementation belongs to implementation.
All specialist dispatch remains subject to the enabled selected profile and task need.

| Owner | Consumes | Produces |
| --- | --- | --- |
| `mbse` (`roles.mbse.sessions.planning`), when enabled and needed | confirmed scope, frozen requirement skeleton (UIDs and titles), frozen decisions, source contracts, standards | checked and repaired requirements/register and acceptance criteria, modeling mode, placement receipt, and view metadata with traceability |
| `integration_test` (`roles.integration_test.sessions.planning`), when enabled and needed | confirmed scope, frozen requirement skeleton (UIDs and titles), frozen decisions, architecture/interfaces | authored and self-checked `seit.json`, proof cases, boundary/data-flow contract, integration steps/order, recovery, resource groups, expected gate cost, and selected verification claims |
| Planning Orchestrator | selected specialists' completed inputs and confirmed context | final technical plan (one plan per phase), `design.md`, `implementation.json`, DoD Manifest projection, and `handoff.md` |

Freeze the requirement skeleton (UIDs and titles) and active decisions at
specialist dispatch so `mbse` and `integration_test` start in parallel once their
required inputs are ready; final planning/design follows their completed inputs.
Needed decision changes surfaced during the specialist wave wait for assembly
rather than amending frozen decisions mid-wave.
Authors inspect and repair their own drafts in their assignment, folding all
known corrections into their first return. Mechanical register prechecks belong
to the requirements author (`mbse`); do not add a separate quality-check agent or wait
for an independent requirements verdict. No correction loops in planning and a
zero author-known relaunch budget (`0` relaunches): never relaunch a returned
specialist for author-known fixes. During assembly, the Planning Orchestrator
may apply purely mechanical ID and hash binding fixes itself, recording each edit
in an edit record, while any change of meaning returns to the owning author
under an authorized return rather than silent rewrite. Only end-of-planning
review findings on specialist-owned content return to that author as a named delta.

### Author-known deltas (#221)

No correction loops in planning (#578, #581): specialists fold known corrections
into their first return, and author-known reconciliation counts against a budget
of zero relaunches (`0` relaunches). During assembly, the Planning Orchestrator
applies purely mechanical ID and hash binding fixes itself with an edit record,
instead of relaunching returned specialists, while changes of meaning return to
the owning author (`mbse` or `integration_test`) under an authorized return.
Sometimes an author working on its own artifact finds an exact correction that
belongs in another role's artifact. One example is `integration_test` finding a
wrong value in a shared contract while authoring `seit.json`. That
correction is an author-known delta, not a review finding. It is reconciled at
the next reconciliation inside the wave rather than relaunching returned
specialists. It never waits for the end-of-wave review.

- **Reconciliation point:** this is the moment the Orchestrator consumes the
  return that names the delta. Apply or route the delta before dispatching any session
  that consumes the affected artifact, and in every case before final
  assembly, freeze, or review dispatch.
- **Routing and mechanical-fix rule:** deltas on the Orchestrator's own final
  plan, design, graph, or Manifest are applied in its existing session. A delta
  on specialist-owned content goes into that author's open assignment only if
  that assignment has not yet returned; any delta packet lets the author fix its
  own defects found in the delta (never forbid self-repair with "nothing else
  changed"). Once a specialist has returned, never relaunch it for author-known
  deltas (zero relaunch budget): the Planning Orchestrator may apply purely
  mechanical ID and hash binding fixes itself during assembly (and close
  `exact_text` rows mechanically with `hooks/correction-delta.cjs` where
  applicable), recording each edit in an edit record (file, target ID/field,
  change, reason, and candidate). Any change of meaning returns to the owning
  author (`mbse` or `integration_test`) under an authorized return rather than
  silent Orchestrator rewriting or an unbudgeted author-known relaunch.
- **Bindings:** refresh cross-artifact sha256 bindings once, after all deltas
  at that reconciliation are applied, not after each edit.
- **Budget:** author-known reconciliation counts against a budget of zero
  relaunches (fold into the author's first return or an Orchestrator mechanical
  ID/hash fix); these deltas spend no `max_assurance_rounds`, no planning-review
  round, and no repair. The one review and one repair stay reserved for
  findings the requested review discovers.
- **Planning inputs, not the repair:** a specialist finding on another author's artifact,
  including one that changes meaning, rationale, verification, or allocation,
  owner-added scope, and needed decision changes during planning are
  planning inputs. An open owning assignment—or the Planning Orchestrator during
  assembly when the specialist has already returned for mechanical ID/hash
  binding fixes with an edit record, while meaning changes return to the owning
  author under an authorized return—consumes them before assembly, without
  relaunching specialists for author-known fixes; needed decision changes wait
  for assembly rather than amending frozen decisions mid-wave. They start no review round, they are not `requires_regate`, and the repair allowance stays 1.
  Only findings from the single end-of-planning review follow the correction loop.
  A delta raised after the unit's review round opens joins that round's one aggregate
  repair. Neither the delta label nor the reconciliation label can renew a
  spent allowance (`owner-stops.md` class C).

## Efficient task planning

- Keep **one plan per phase**: split multi-phase work into separate phase plans
  rather than combining multiple phases into one plan and multiplying
  cross-artifact bindings. Any scope decision that drops an acceptance item is
  always an owner question box (`OWNER_DECISION_REQUIRED`), even under delegation
  (`owner-stops.md`).

- Give each slice one coherent outcome with a bounded write set, acceptance,
  commands, dependencies, selected author, recovery, and expected evidence.
- Avoid overloaded slices spanning unrelated outcomes and waves that hold ready
  independent work until everything else finishes. Avoid tiny slices whose
  extra handoffs exceed their useful work.
- Prioritize prerequisite and critical-path work that unblocks other slices.
  Dispatch every ready independent slice within the owner-selected capacity;
  do not invent another agent or a fixed slice/wave count.
- State each serialization reason: dependency, shared file, mutable resource,
  or required integration boundary. Name merge hotspots and shared test resources.
- Include gate cost and resource groups in wave planning. Group independent
  checks concurrently and preserve required coverage and security controls.
- Generate the implementation graph from those real dependencies. Wave boundaries
  support integration and the owner's chosen review cadence; they do not create
  automatic per-wave reviews or additional review agents.
- Use Light Implementer only when selected and applicable. Preserve its existing
  command/write-set contract; do not turn classification into another agent pass.

## Assembly, evidence, and handoff

Cross-check IDs, references, dependency edges, write ownership, required evidence,
rollback/recovery, boundary coverage, and selected capability bindings. Copy
`integration_test`'s `boundary_contract` and SEIT/verification selections
mechanically; do not invent technical decisions or V&V claims. When applying
purely mechanical ID or hash binding fixes during assembly, record each edit in
the edit record; any change of meaning returns to its owning author.

Generate `implementation.json` with `review_rounds` and a `planning_wave` that
declares exactly the enabled specialist sessions this task needed (possibly none)
and records `review_requested` as the owner chose. Post-approval planning
corrections append to `journey_settings.planning_corrections` beside
`planning_wave`—each carrying `correction_id`, `from_candidate`, and its own
per-correction sessions, review receipt (`correction_id`), optional one-repair
lineage, deterministic closure, and `closing_candidate`—keeping round-1
`planning_wave` and receipts byte-identical while binding the latest correction's
`closing_candidate` to the current manifest digest. Generate the DoD Manifest
(`planning`, append-only closeout). Use
`node <plugin root>/hooks/plan-package.cjs draft <plan dir>` for draft checks and
the candidate-bound final freeze when its receipts are complete: every declared
session `READY`, required artifacts present, and deterministic closure. Earlier specialist returns may be explicitly adopted to the no-review closing
candidate only when every consumed input matches the actual verified closing
snapshot; retain the original return identity. Changed consumed inputs block
adoption, and recorded hashes never substitute for checking file bytes. Missing
required receipts remain typed gaps, never a pass. The current freeze contract
must be satisfied or explicitly amended, never bypassed by prose.

Planning review is a separate pre-dispatch gate; never consumes implementation
assurance. The planning wave has the implementation-wave budget (`cadence: phase`,
one review, one repair). It runs only when the owner requested it at this boundary, under
`review-policy.md`; `hooks/planning-review.cjs` `evaluatePlanningReview()` keeps
it closed until the rendered Manifest exists (`manifest_not_generated`). When not
requested, record `review_requested: false` with zero reviews and no receipt;
never dispatch, forge, or infer a reviewer from the package. Implementation
review and assurance follow `assurance-policy.md`: `max_assurance_rounds` is 1
per declared phase or wave-end, one review may authorize one repair verified
deterministically without another review; the original review packet may preauthorize
same-session repair within its exact write set without a parent acceptance round-trip; a failed repair or scope change returns
`OWNER_DECISION_REQUIRED` naming the candidate and count. Preserve spent budgets and candidate
identity; author self-checks never become independent review. Selected or
required `review.coverage_assist` and `deterministic_verification.reverify`
follow their frozen selections when a requested review or assurance session runs;
a selected or required capability that is unavailable is a typed capability gap.

When planning is complete and the owner agreement required for execution is
recorded, write `handoff.md` with exact artifact paths/digests, decisions and
authority, selected routes/capabilities, candidate/worktree, assignments, commands,
evidence, review status, blockers, and next action. Before writing it, run the
handoff check in `hooks/closeout.cjs` with `journey` (`mode: "handoff"`); a
history coverage gap refuses the handoff until its recorder transcribes the listed
decisions, authority events, and landings: Orchestrator when Scribe is omitted or
disabled, otherwise the existing Scribe session on its frozen cadence (see
`resume.md`). Recommend a new Implementation Orchestrator session; do not launch
it automatically or repeat settled planning.

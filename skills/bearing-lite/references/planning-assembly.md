---
type: agent-reference
title: Planning Orchestrator Dispatch and Assembly
tags: [bearing, planning]
---

# Planning dispatch and assembly

The Planning Orchestrator owns coordination, final planning/design, and package
assembly in its current session. Selected specialists own their inputs. No extra
planning controller or final-design author is needed. Reuse completed work.

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
2. **Requirements Engineer, if enabled and needed:** author requirements and
   acceptance criteria from the confirmed Alignment/Scope context and existing
   architecture; run its own quality pass, repairs, and recheck (register precheck
   at `--stage requirements`). Later SEIT case IDs and Modeler placements are
   recorded pending bindings with named owners, not prerequisites for `READY`.
3. **Systems Modeler, if enabled and needed:** use those requirements, current
   architecture, and existing contracts to supply placement/model evidence.
   Do not require the later integration plan as an input to this earlier step.
4. **Integration Engineer planning, if enabled and needed:** consume requirements,
   architecture, model evidence, and proposed interfaces; author the boundary contract,
   recovery, and validation steps with expected evidence.
5. **Planning Test Engineer, if enabled and needed:** consume requirements,
   architecture, proposed interfaces, and applicable boundary/model evidence;
   author the test/validation plan, SEIT, and proof cases bound to the existing
   requirement IDs. Do not write product tests.
6. **Planning Orchestrator — final Planning and Design:** synthesize the completed
   inputs into the technical plan and `design.md`, copy the confirmed quantity
   table into its glossary, allocate against the placement receipt, then assemble
   the implementation graph and Manifest. Validate every required allocation and
   case binding (final-stage `hooks/register-precheck.cjs` with `--seit`) and
   cross-artifact coverage; pending bindings block assembly until completed.
   This final planning step runs in the existing controller, not another agent.
7. **Requested planning review:** after the complete final plan/design and assembly,
   run the profile-enabled Reviewer only when the owner requested review at this
   boundary. Review the exact stable package; address findings only within the
   authorized repair allowance and rerun affected deterministic checks.
   Otherwise record planning review as not requested; do not add a reviewer.
8. **Owner confirmation and handoff:** obtain the execution authority required
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
   candidate and authority, and schedules dependency-ready implementation slices.
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
| Requirements Engineer, when needed | confirmed scope, source contracts, standards | requirements/register and acceptance criteria, checked and repaired by its author |
| Systems Modeler, when enabled and needed | architecture, requirements, existing contracts | model views and placement evidence in its single selected assignment |
| Integration Engineer planning, when enabled and needed | requirements, architecture/models, proposed interfaces | Boundary/Data-Flow Contract, assembly strategy, recovery, and validation steps with expected evidence |
| Planning Test Engineer, when enabled and needed | requirements, architecture/interfaces, boundary/model evidence | authored and self-checked `seit.json`, proof cases, resource groups, expected gate cost, and selected verification claims |
| Planning Orchestrator | selected specialists' completed inputs and confirmed context | final technical plan, `design.md`, `implementation.json`, DoD Manifest projection, and `handoff.md` |

Start each selected author once when its required inputs are ready. Requirements
precede dependent specialist work; final planning/design follows their inputs.
Run independent work concurrently;
serialize real input dependencies, overlapping writes, or shared mutable resources.
Authors inspect and repair their own drafts in their assignment. Mechanical
register prechecks belong to the requirements author; do not add a separate
quality-check agent or wait for an independent requirements verdict. Findings on
specialist-owned content return to that author as a named delta; the Orchestrator
never edits requirements or SEIT itself.

### Author-known deltas (#221)

Sometimes an author working on its own artifact finds an exact correction that
belongs in another role's artifact. One example is a Test Engineer who finds a
wrong value in the implementation graph while authoring `seit.json`. That
correction is an author-known delta, not a review finding. It returns to the
owning author at the next reconciliation inside the wave. It never waits for
the end-of-wave review.

- **Reconciliation point:** this is the moment the Orchestrator consumes the
  return that names the delta. Route the delta before dispatching any session
  that consumes the affected artifact, and in every case before final
  assembly, freeze, or review dispatch.
- **Routing:** deltas on the Orchestrator's own final plan, design, graph, or
  Manifest are applied in its existing session. A delta on specialist-owned
  content goes into that author's open assignment. If the assignment has
  already returned, it goes in one named-delta packet to that author. Send at
  most one packet per owner per reconciliation, covering only the named
  `exact_text` rows and closed mechanically with `hooks/correction-delta.cjs`.
  The identifying author's return supplies the `findings` rows and corrected
  text in place of a gate report. Do not reopen the author's full assignment.
- **Bindings:** refresh cross-artifact sha256 bindings once, after all deltas
  at that reconciliation are applied, not after each edit.
- **Budget:** these deltas spend no `max_assurance_rounds`, no planning-review
  round, and no repair. The one review and one repair stay reserved for
  findings the requested review discovers.
- **Not covered:** a delta that changes meaning, rationale, verification, or
  allocation is `requires_regate` and follows the correction loop. A delta
  raised after the unit's review round opens joins that round's one aggregate
  repair. Neither the delta label nor the reconciliation label can renew a
  spent allowance (`owner-stops.md` class C).

## Efficient task planning

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
rollback/recovery, boundary coverage, and selected capability bindings. Copy the
Integration Engineer's `boundary_contract` and the Test Engineer's SEIT/verification
selections mechanically; do not invent technical decisions or V&V claims.

Generate `implementation.json` with `review_rounds` and a `planning_wave` that
declares exactly the enabled specialist sessions this task needed (possibly none)
and records `review_requested` as the owner chose. Generate the DoD Manifest
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
deterministically without another review; a failed repair or scope change returns
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

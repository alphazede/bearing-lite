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

## Process tiers and stated risk rule

Select the smallest process tier whose risk rule covers every risk factor
established in Alignment/Scope (unless the owner explicitly specifies a tier):

- **`light` (Orchestrator plus one author):** localized, reversible, or
  mechanical/setup/tooling/docs work with no new or changed trust boundary,
  stateful protocol, persisted schema, cross-component contract, or
  requirements-register authoring. Planning stays in the Orchestrator
  (`required_sessions: []`, no separate requirements register, SysML/formal
  model, or specialist fan-out); execution uses one author (Implementer or
  Light Implementer).
- **`standard`:** moderate-risk multi-module feature or behavioral change within
  settled architecture and contracts without new trust boundaries, protocol
  state machines, multi-wave coordination, or specification-register authoring.
  Also applies to a **copy-only or read-only** phase that crosses into a host
  with **live services** (and carries no other `full`-tier risk factor) when
  paired with a required **before and after live-service observation** (one
  implementer, one review, no separate assurance; see
  `verification.md#process-tier-resolution`). Dispatch only the enabled
  specialist(s) the work needs (for example `integration_test` for
  SEIT/boundary updates, or `mbse` only when new requirements or placements are
  needed; skip unneeded specialists).
- **`full`:** high-risk or specification-grade work — touches trust boundaries
  (auth, authorization, crypto, privilege, tenant/data isolation), irreversible
  or high-impact state/money/data loss (including any live-host phase that
  deletes or mutates, which resolves as before), new or changed stateful
  protocols or concurrency contracts, multi-wave architecture, or
  specification-register authoring (`journey_type: specification`). Runs the
  full enabled planning wave (`mbse` and `integration_test` in parallel from
  the frozen requirement skeleton) and full declared execution/assurance cadence.

## Planning order

This is the default dependency order, not a requirement to enable every role:

1. **Planning Orchestrator:** confirm Intake, combined Architectural Alignment
   and Scope (reusing the previous `repository-map.md` after a freshness check),
   the selected profile, chosen process tier (`light`, `standard`, or `full`),
   required deliverables, and existing evidence.
   At specialist dispatch (in `standard` or `full` tier), freeze the
   **requirement skeleton (UIDs and titles)**
   and **active decisions**; never amend decisions mid-wave while specialists
   are running—any needed decision change waits for assembly.
2. **`mbse` (`roles.mbse.sessions.planning`) and `integration_test` (`roles.integration_test.sessions.planning`), if enabled and needed — start in parallel:**
   both launch concurrently from the frozen requirement skeleton (UIDs and
   titles), frozen decisions, and confirmed Alignment/Scope context, with a time
   target and `"at the limit, return what you have and list the gaps"` in every
   packet. Each specialist runs only its own artifact checker (never the
   repository gate) and returns digests, commands, and exit codes, not narrative
   logs:
   - **`mbse` (`roles.mbse.sessions.planning`):** author full requirement
     statements and acceptance criteria from the confirmed Alignment/Scope
     context and frozen requirement skeleton, running its own quality pass,
     repairs, and recheck (register precheck at `--stage requirements` and
     applicable register/workspace lint only; later SEIT case IDs are recorded
     pending bindings, not prerequisites for `READY`), and supply the modeling
     mode, placement receipt (current flow, candidate placements with
     `file:line`, constraints, and requirement-to-component mappings), and view
     metadata with traceability.
   - **`integration_test` (`roles.integration_test.sessions.planning`):** consume
     the frozen requirement skeleton (UIDs and titles), frozen decisions,
     architecture, and proposed interfaces; author `seit.json` (verification
     cases, boundary/data-flow contract, assembly/recovery strategy, integration
     steps and order, validation steps with expected evidence, resource groups,
     expected gate cost, and selected verification claims) bound to the frozen
     requirement UIDs, running only its own SEIT/boundary artifact self-checks.
     Do not write product tests.
   Pending cross-artifact bindings are reconciled at assembly; do not serialize
   `mbse` and `integration_test` into sequential specialist gates.
3. **Planning Orchestrator — final Planning and Design:** synthesize the completed
   inputs into the technical plan and `design.md` (keeping **one plan per phase**;
   split multi-phase work into separate phase plans), copy the confirmed quantity
   table into its glossary, allocate against the placement receipt, then assemble
   the implementation graph and Manifest. Run the repository gate once at assembly
   alongside final-stage `hooks/register-precheck.cjs` with `--seit` and
   cross-artifact coverage checks; pending bindings block assembly until
   completed.
   This final planning step runs in the existing controller, not another agent.
4. **Requested planning review:** after the complete final plan/design and assembly,
   run the profile-enabled Reviewer only when the owner requested review at this
   boundary. Review the exact stable package; address findings only within the
   authorized repair allowance and rerun affected deterministic checks.
   Otherwise record planning review as not requested; do not add a reviewer.
5. **Owner confirmation and handoff:** obtain the execution authority required
   for the exact package, complete its declared final checks, and write
   `handoff.md`. Apply the approved clean-session choice.

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

1. The Implementation Orchestrator verifies the `final_freeze_receipt` in the
   approved handoff using the [handoff template](../templates/handoff.md),
   returning to planning before dispatch if the receipt is absent, invalid, or
   `draft`-only. The Orchestrator validates the candidate and authority, executes the frozen plan,
   and starts every ready slice whose declared `inputs` and dependencies are met and whose held `resource` and `write_set` are free (`hooks/ready-set.cjs`), without holding independent slices for wave order. Run the first implementation slice (preflight) with every planned command in dry-run or `--version` form on every target host in parallel before dependent host slices, and end any phase that builds a host by running that repository's real gate on it. The pace rules are in
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

### One closing return (authorized return)

To close a specialist `GAPS` return (#593) or fix a meaning defect found at
assembly (#595), the Planning Orchestrator authorizes **one closing return**: it
may resume the owning author's (`mbse` or `integration_test`) own session once
to close the listed gaps or fix the named meaning defect. That resume is **not a
relaunch** (it does not count against the zero author-known relaunch budget).
It is recorded (`author`, `reason`, `items`, `candidate`, and resulting
`verdict`: `READY` or `CANDIDATE_READY`) on the session (`closing_return`) or in
`planning_wave.closing_returns[]`. If the closing return needs adoption, put
its consumed `inputs` and `adopted_to` candidate on that return.
`hooks/plan-package.cjs` (`final`) accepts
the resulting `READY` when one valid closing return is recorded and refuses
unclosed `GAPS`, incomplete records, or a second closing return for the same
author.

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
  cross-artifact bindings. Decide per phase between a **short reviewed command
  list** (`reviewed_command_list`) and **new reusable tooling**
  (`new_reusable_tooling`), record why in `journey_settings.tooling_choice` and
  the technical plan, and state its reuse (`reuse`) whenever new tooling is
  chosen (prefer a short reviewed command list for one-off operational work). Any
  scope decision that drops an acceptance item is
  always an owner question box (`OWNER_DECISION_REQUIRED`), even under delegation
  (`owner-stops.md`).

- Give each slice one coherent outcome with a bounded write set, acceptance,
  commands, real `inputs`, held `resource` (when exclusive: host, repository, or worktree), dependencies, selected author, recovery, and expected evidence.
  Plan the first implementation slice as a preflight slice running every planned
  command in dry-run or `--version` form on every target host in parallel, and
  end any phase that builds a host by running that repository's real gate on it.
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
- Generate the implementation graph from those real dependencies and held resources. `hooks/plan-package.cjs` flags (without refusing the freeze) any ordering edge between slices that share no input or resource (`false_serial_chain`). Wave boundaries
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

Before review, record the checkout-relative package directory as
`- plan_dir: <directory>` in the bound, in-progress task block. From the
checkout root, the Orchestrator can update one existing binding line per edit
in that package. Refresh a `seit.json` planning-input SHA-256
from the named Markdown source in that plan directory. Complete a pending
`VERIFICATION_CASE_ID` line in the registered SDoc using cases already in
`seit.json` for that same requirement. Ask MBSE at dispatch to write
`VERIFICATION_CASE_ID: pending` where a case ID will arrive later. Preserve
established cases and source paths. Use a single-line Edit or native
apply_patch with one context-free `@@` hunk containing the exact removed
and added lines. Record the path, field, before and after values, source
and candidate. A refused edit remains a gap in the assembly return.

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
session `READY` (or a `GAPS` session closed to `READY` through one recorded
closing return), required artifacts present, and deterministic closure. Earlier specialist returns may be explicitly adopted to the no-review closing
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
recorded, write `handoff.md` per `../templates/handoff.md` with
`final_freeze_receipt` (`stage: "final"`, `outcome: "PASS"`, `manifest_digest`,
command, and exit code), exact artifact paths/digests, decisions and
authority, selected routes/capabilities, candidate/worktree, assignments, commands,
evidence (digests, commands, and exit codes, not narrative logs), review status,
blockers, and next action. Every dispatched packet carries a time target and
"at the limit, return what you have and list the gaps". Before writing `handoff.md`, run the
handoff check in `hooks/closeout.cjs` with `journey` (`mode: "handoff"`) and
the structured `final_freeze_receipt` from `node <plugin root>/hooks/plan-package.cjs <plan dir>`.
A missing or invalid final freeze receipt refuses the
handoff (`handoff_refused:final_freeze_receipt_missing` or `_invalid`), and a
history coverage gap refuses the handoff until its recorder transcribes the listed
decisions, authority events, and landings: Orchestrator when Scribe is omitted or
disabled, otherwise the existing Scribe session on its frozen cadence (see
`resume.md`). Follow the approved clean-session choice in
`journey_settings.planning_to_implementation_clean_session`. The owner opens
the fresh session when selected. Implementation resumes from the handoff.

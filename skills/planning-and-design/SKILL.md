---
name: planning-and-design
description: >
  Perform final planning/design in the Planning Orchestrator's current session
  after the selected specialists return. Use for final plan/design and assembly
  or an authorized planning correction. Do not dispatch a separate author, repeat
  specialist requirements or SEIT work, or start implementation.
---

# Final Planning and Design

Controller procedure, not a configured specialist role or extra invocation. Use `../bearing-lite/SKILL.md` and its planning-assembly instructions.

## Inputs and loop

Consume confirmed alignment/scope (including the chosen process tier: `light` —
Orchestrator plus one author — `standard`, or `full`), the frozen requirement
skeleton (UIDs and titles) and frozen decisions established at specialist
dispatch, requirements and definitions, `mbse` (`roles.mbse.sessions.planning`)
architecture/model inputs, `integration_test`
(`roles.integration_test.sessions.planning`) boundary, assembly, and SEIT
contracts, evidence, selected routes/capabilities, cadence, authority, and
repository rules. `mbse` and `integration_test` start in parallel from the
frozen requirement skeleton and decisions when required by the process tier and
task; in `light` tier, skip unneeded specialist sessions (`required_sessions: []`)
and keep the package proportional to the work. Any needed decision change
surfaced mid-wave waits for assembly rather than amending decisions mid-wave.
Reuse adequate sources for inactive roles; expose missing required inputs rather
than inventing them.
Any unresolved material scope, behavior, authority, risk, or
acceptance intent returns `REROUTE_SCOPE_DEFINITION` to combined alignment/scope in
this controller session; generate no `implementation.json` or Manifest and never
choose for the owner. Any scope decision that drops an acceptance item is an
owner question box (`OWNER_DECISION_REQUIRED`), even under delegation.

1. Verify settled intent and source/candidate bindings. Establish whether a
   requirements register exists; if evidence cannot decide, ask the owner. Never
   infer one; keep register references versus Lifecycle-local requirements distinct.
2. Author the technical plan and `design.md` from the completed inputs, keeping
   **one plan per phase** (split multi-phase work into separate phase plans
   instead of combining multiple phases into one plan). Decide per phase between
   a **short reviewed command list** (`reviewed_command_list`) and **new reusable
   tooling** (`new_reusable_tooling`), record why in the plan and
   `journey_settings.tooling_choice`, and state its reuse whenever new tooling is
   chosen (avoid building general tooling for one-off operational work). Preserve
   registered IDs and definitions, published-standard clauses, trust boundaries, and recovery.
   Copy the confirmed quantity-definitions table into the glossary verbatim (`references/artifact-grammar.md`).
   Allocate requirements to components from the placement receipt per `references/allocation-inputs.md`.
   Author the OOPDSA Implementation Design section per `references/oopdsa-design.md`; plan programs per `references/program-planning.md`.
   Do not draft a duplicate requirements register or SEIT.
3. Build coherent bounded slices and dependency-based waves with exact write sets,
   real `inputs`, held `resource` (host, repository, or worktree when exclusive), acceptance, commands, shared resources, and serialization reasons. Tests meet
   `../test-engineer/references/shared-machine-tests.md`; engine-backed cases carry
   `resource_group`/`expected_gate_seconds`, waves `added_gate_seconds`/`resource_groups`.
   Prioritize prerequisite work and parallel ready work; avoid overloaded batches and false serial chains between slices that share no input or resource (`plan-package.cjs` flags them at assembly without refusing the freeze).
4. Assemble `implementation.json` and the DoD Manifest (one plan per phase). Copy specialist-owned
   decisions faithfully per `../bearing-lite/references/planning-assembly.md`;
   choose no new roles or capability defaults. Record `planning_wave` (`required_sessions`, `review_requested`); append post-approval corrections to `planning_corrections` without mutating round 1.
5. Check your own final package: run the repository gate once at assembly
   alongside the register precheck at its final stage with `--seit`, every
   pending binding completed, and `plan-package.cjs draft` (planning specialists
   run only their own artifact checker, never the repository gate). Record
   evidence as digests, commands, and exit codes, not narrative logs. Repair
   your owned artifacts in-session and rerun affected checks. Under the zero
   author-known relaunch budget (`0` relaunches), apply purely mechanical ID and
   hash binding fixes in-session and record each edit in an edit record; never
   rewrite meaning silently—any change of meaning returns to the owning author
   (`mbse` or `integration_test`, including a meaning defect found at assembly)
   under the **one closing return** authorized by the Planning Orchestrator (the
   same closing return path used for a `GAPS` return, resuming the author's own
   session once—which does not count as a relaunch—recorded with `author`,
   `reason`, `items`, `candidate`, and resulting `READY`), and missing
   specialist facts stay gaps returned to their owner, never authored by the
   Orchestrator itself.
6. Requested planning review opens only after `hooks/planning-review.cjs`
   `evaluatePlanningReview()` passes its guards (`manifest_not_generated` without
   the rendered Manifest). Then obtain one integrated owner confirmation (never
   insert a profile or route pause), run the final freeze, write the handoff,
   and recommend a new Implementation Orchestrator session.

## Return and recovery

Return `READY`, `REROUTE_SCOPE_DEFINITION`, `WAITING_ON`, or
`OWNER_DECISION_REQUIRED` with candidate, paths, checks (digests, commands, and
exit codes, not narrative logs), open items, and next
action. Every packet dispatched carries a time target and "at the limit, return
what you have and list the gaps". An authorized named delta packet applies named findings only, through
`references/correction-loop.md` and `hooks/correction-delta.cjs`, within its
existing authority and allowance; specialist-owned rows return to their author,
and delta packets let the author fix its own defects found in the delta (never
forbid self-repair with "nothing else changed").
This controller author check is not independent review or an extra agent pass.

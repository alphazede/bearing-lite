---
name: bearing-lite
description: >
  Coordinate a Bearing lifecycle as Planning or Implementation Orchestrator only
  when the owner explicitly requests Bearing for that mode. Do not activate for
  ordinary work, model or role selections, assigned packets, implementation work
  without that request, or advisory-hook suggestions.
---

# Bearing Orchestrator

Coordinate planning, implementation, verification, validation and delivery. Preserve scope, agents, authority and evidence.
Own lifecycle state and owner communication; unrequested review stays inactive. Resolve wave escalations using `references/owner-stops.md`.
After opt-in, bind the session/task in the project plan per `templates/task.md`; installation, old plans, or role names never activate hooks. On resume, follow `references/resume.md` first; continue the recorded mode and next unfinished action.
Use the [catalog reference](references/profiles.md) to select a profile. An
explicit setup or catalog-edit request uses [onboard-bearing](../onboard-bearing/SKILL.md).
## Modes

- **Planning Orchestrator:** owns context, specialist dispatch, final plan/design, owner agreement, and the written handoff; does not dispatch implementation.
- **Implementation Orchestrator:** checks handoff and follows `references/coordinator-migration.md` for wave duties and frozen legacy assignments.

1. **Intake:** use `../intake/SKILL.md` to confirm repository and task location. Reuse confirmed inputs; ask only on material ambiguity. Start the Orchestrator in a directory that survives cleanup (outside disposable task worktrees) and name the worktree explicitly for short commands so no Orchestrator process holds a worktree open during cleanup.
2. **Architectural Alignment and Scope:** use `../architectural-alignment/SKILL.md`
   in the controller session to establish architecture, constraints, and shared
   scope. Reuse the previous `repository-map.md` after a freshness check,
   refreshing only stale or newly affected parts. Own the workspace and map; add
   no second scope stage or agent.
3. **Planning:** select the process tier (`light` — Orchestrator plus one author —
   `standard`, or `full`) by the stated risk rule in
   `references/planning-assembly.md`, including the
   [live-host tier exception](references/verification.md#process-tier-resolution)
   when applicable. Coordinate only the profile-enabled
   specialists required by that tier and task, then author final plan/design and
   assemble the package using `references/planning-assembly.md`. Specialists run
   only their own artifact checker; the repository gate runs once at assembly, and
   evidence returns digests, commands, and exit codes, not narrative logs. Run
   requested planning review after assembly, before owner confirmation/handoff.
4. **Implementation:** at intake, verify the `final_freeze_receipt` in
   `handoff.md` using the [handoff template](templates/handoff.md). If the receipt
   is absent, invalid, or `draft`-only, return to planning before dispatch.
   Once verified, consume the handoff. In selected TDD, run the frozen Test Implementer (`roles.test_implementer`)
   before Product Implementer. Send `work_class: light` slices to a selected Light Implementer; `reclassify: judgement`
   returns them to Implementer. [Evaluate readiness across the frozen graph](references/coordinator-migration.md#completion-notifications-and-recovery)
   and start every ready slice whose declared `inputs` and dependencies are met
   and whose held `resource` (host, repository, worktree, or `resource_groups`)
   and `write_set` are free. Honor the frozen dispatch authority and agent cap.
   Run the first implementation slice as a preflight slice with every planned
   command in dry-run or `--version` form on every target host in parallel, and
   end any phase that builds a host by running that repository's real gate on it.
   When `snapshot.fellow` is present, follow the [Fellow consultation guide](references/consultation.md).
   Consult before a major decision (with options and a leaning in hand), when
   stuck after two genuine attempts, facing unexplained behavior, or preparing
   a workaround. Also consult before declaring a task done and when the owner asks.
   The Implementation Orchestrator owns new waves.
   For a frozen legacy Coordinator assignment, use its pinned runtime or obtain an explicit handover
   before continuing.
5. **Review:** dispatch the owner-requested review immediately after the
   recorded boundary passes deterministic checks. Use the approved
   slice, phase, or lifecycle cadence for the selected review. When independent
   assurance is requested on a multi-slice phase or wave, assurance may start
   early on finished slices' immutable receipts and the pinned candidate while
   the last slice runs, joining the last slice's receipts before its verdict
   while keeping single-run role and gate budgets. The approved
   task plan supplies task and rolling batch boundaries. A recorded request
   requires no further approval. An independent evaluator is a reviewer.
   Preserve selected assistance tools; preauthorize bounded same-session repair in the
   original packet and consume consolidated evidence without per-finding approval. For
   a review before a first live apply, include the frozen host and class rows and
   the exact proposed operand list, not only the executor diff. Add no quality agents.
6. **Landing and closeout:** land each closed unit (`references/task-state.md#landing-a-closed-unit`); check deliverables and evidence. Distinguish
   author checks, requested review, merge, deployment, and activation; report remaining obligations.

## Planning handoff

Write `handoff.md` using `templates/handoff.md` and the Prompt skill (`../prompt/SKILL.md`) in the confirmed plan directory when planning is complete. Include `final_freeze_receipt` (`stage: "final"`, `outcome: "PASS"`, `manifest_digest`, command, and exit code from `hooks/plan-package.cjs`; a `draft` freeze does not satisfy it), exact plan paths and digests, scope, owner decisions and authority,
selected models/harnesses/capabilities, candidate and worktree, assignments and write sets, commands, evidence, review status, blockers, and the next action. When work crosses a target host, state in the plan and `handoff.md` how the exact candidate and its proof travel to the target host, who may approve that transport (owner or explicit delegate within `authority.json`), and what may land locally when the host gate cannot run.
Honor the approved `planning_to_implementation_clean_session` setting. When
true, recommend a new Implementation Orchestrator session with this handoff.
When false, continue from the durable handoff here. Resolve an unset choice
during integrated owner confirmation. The owner opens a fresh session.
The implementation session consumes settled planning; it does not repeat it.
Handoff and closeout pass `journey` to `hooks/closeout.cjs`; untranscribed decisions, authority events, or landings refuse them until the configured recorder transcribes them. On `mode: "handoff"`, `hooks/closeout.cjs` also requires a valid `final_freeze_receipt` and refuses the handoff when absent or `draft`-only.
## Dispatch and recovery

Preserve the recorded profile; use `references/profiles.md` for authorized amendments.
Launch each selected agent assignment once. Every packet carries a time target
and "at the limit, return what you have and list the gaps". Extra invocations, retries, repairs,
or resumed agent runs require explicit authority; self-correction stays in-run.
An enabled Scribe uses one session at its frozen cadence (`event` default); never relaunch it per event or phase. When disabled or omitted, Orchestrator records history.
Register native completion notifications at dispatch. Wait through the harness's event mechanism; wake when an agent response arrives.
Consume each response once and dispatch newly ready work. Never poll logs, processes,
status, or worktrees, or use timers/sleep loops for periodic “still running” checks.
If event waiting is unavailable, return `WAITING_ON`; resume on the actual response.
Use `references/task-state.md` for state integrity, `references/resume.md` for resume and Scribe coverage, and `references/owner-stops.md` for authority/intent stops. Never replay completed stages or change routes.
Selected or required capabilities activate; unavailability, including a needed MBSE route omitted or disabled, is a typed capability gap, not substitution, not success, not invented behavior. Unselected and unrequired absence remains inactive, not a global failure.
Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE` with mode,
stage, candidate, completed work, evidence, blocker, and next action.
Never expand scope, author delegated artifacts, invent decisions, or pass missing evidence.
Any scope decision that drops an acceptance item is an owner question box (`OWNER_DECISION_REQUIRED`), even under delegation.

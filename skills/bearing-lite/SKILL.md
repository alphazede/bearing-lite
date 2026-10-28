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
Own lifecycle state and owner communication; unrequested review stays inactive. Resolve Coordinator escalations using `references/owner-stops.md#coordinator-escalation-and-delegation`; delegation defaults off and requires scoped authority.
After opt-in, bind the session/task in the project plan per `templates/task.md`; installation, old plans, or role names never activate hooks. On resume, follow `references/resume.md` first; continue the recorded mode and next unfinished action.
## Modes

- **Planning Orchestrator:** owns context, specialist dispatch, final plan/design, owner agreement, and the written handoff; does not dispatch implementation.
- **Implementation Orchestrator:** consumes the handoff, checks authority/candidate, dispatches enabled roles, and owns delivery.

1. **Intake:** use `../intake/SKILL.md` to confirm repository and task location. Reuse confirmed inputs; ask only when material ambiguity remains.
2. **Architectural Alignment and Scope:** use `../architectural-alignment/SKILL.md`
   in the controller session to establish architecture, constraints, and shared
   scope. Own the workspace and map; do not add a second scope stage or agent.
3. **Planning:** coordinate profile-enabled specialists, then author final plan/design
   and assemble the package using `references/planning-assembly.md`. Run requested
   planning review after assembly, before owner confirmation and handoff.
4. **Implementation:** consume the handoff; in selected TDD run the frozen Test Implementer (`roles.test_implementer`)
   before Product Implementer. Send `work_class: light` slices to a selected Light Implementer; `reclassify: judgement`
   returns them to Implementer. Honor dependencies, commands, and write sets; use
   `../coordinator/SKILL.md` only for a justified profile-enabled coordination role.
5. **Review:** dispatch only when explicitly requested, at the chosen task, phase,
   or lifecycle boundary. A differently named independent evaluator is a reviewer.
   Preserve selected assistance tools; preauthorize bounded same-session repair in the
   original packet and consume consolidated evidence without per-finding approval. Do not add quality agents.
6. **Closeout:** check deliverables and deterministic evidence. Distinguish author
   checks, requested review, deployment, and activation; report remaining obligations.
## Planning handoff

Write `handoff.md` using the Prompt skill (`../prompt/SKILL.md`) in the confirmed plan directory when planning is complete. Include exact plan paths and digests, scope, owner decisions and authority,
selected models/harnesses/capabilities, candidate and worktree, assignments and write sets, commands, evidence, review status, blockers, and the next action.
Recommend starting a new session as Implementation Orchestrator with this handoff. Do not launch it automatically; continuing in the current session is an owner choice.
The implementation session consumes settled planning; it does not repeat it.
Handoff and closeout pass `journey` to `hooks/closeout.cjs`; untranscribed decisions, authority events, or landings refuse them until the configured recorder transcribes them.
## Dispatch and recovery

Preserve the recorded profile; use `references/profiles.md` for authorized amendments.
Launch each selected agent assignment once. Extra invocations, retries, repairs,
or resumed agent runs require explicit authority; self-correction stays in-run.
An enabled Scribe uses one session at its frozen cadence (`event` default); never relaunch it per event or phase. When disabled or omitted, Orchestrator records history.
Register native completion notifications at dispatch. Wait through the harness's event mechanism; wake when an agent response arrives.
Consume each response once and dispatch newly ready work. Never poll logs, processes,
status, or worktrees, or use timers/sleep loops for periodic “still running” checks.
If event waiting is unavailable, return `WAITING_ON`; resume on the actual response.
Use `references/task-state.md` for state integrity, `references/resume.md` for resume and Scribe coverage, and `references/owner-stops.md` for authority/intent stops. Never replay completed stages or change routes.
Selected or required capabilities activate; unavailability, including a needed Coordinator or Systems Modeler omitted or disabled, is a typed capability gap, not substitution, not success, not invented behavior. Unselected and unrequired absence remains inactive, not a global failure.
Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE` with mode,
stage, candidate, completed work, evidence, blocker, and next action.
Never expand scope, author delegated artifacts, invent decisions, or pass missing evidence.

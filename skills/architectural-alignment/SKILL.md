---
name: architectural-alignment
description: >
  Establish architectural fit and resolve material scope decisions after Intake
  is confirmed. Use for Architectural Alignment, Scope Definition, missing or
  stale context, or unresolved intent in an explicitly requested Bearing
  lifecycle. Do not use for already-settled current context, design,
  implementation, independent review, or an unconfirmed repository.
---

# Architectural Alignment and Scope

The Orchestrator runs this once in its controller session, owning `workspace.md`
and `repository-map.md`. Establish architectural fit and shared scope before design.
Use the requested outcome, confirmed repository and plan directory, prior owner
decisions, source evidence, and repository rules. Run after Intake is confirmed.
Completed alignment is not repeated unless relevant source changes invalidate
its map or the requested scope changes. Reuse confirmed scope and current evidence.

## Algorithm

1. Verify the exact root, repository identity, plan directory, and requested
   scope. Conflicting identity returns `BLOCKED`; never invent a sibling path.
2. Verify source bindings and scoped committed, staged, unstaged, and relevant
   untracked changes. Compare recorded revisions and content digests with current
   inputs; a clean Git status alone does not prove freshness. Refresh affected
   context only. Missing bindings require fresh evidence.
3. Read canonical architecture, relevant manifests, instructions, entry points,
   tests, and ownership records; follow evidence into `docs/`, `src/`, and `lib/`.
   Use BRAN with native policy; otherwise report `bran_status: unavailable`.
   Bound discovery to the authorized task and affected flows. Never ask the
   owner for a fact tools can establish, or invent architecture or commands.
4. Map components, interfaces, data flow, ownership, constraints, and trust
   boundaries with sources. Explain where the requested work fits; distinguish
   facts, inferences, and gaps. Do not design missing architecture, activate a
   specialist automatically, or choose material changes or risk for the owner.
5. Track material outcome, scope, authority, risk, and acceptance decisions as
   dependency-ordered branches. Ask exactly one question whose prerequisites are
   settled, give the recommended answer and material alternatives, then wait.
   Challenge contradictions and vague acceptance. Silence is not approval;
   revisit a settled answer only when scope or conflicting evidence changes it.
6. Buffer confirmed decisions in the active session. Do not persist, patch, or
   re-render Lifecycle state after each answer. At a completed branch, before
   Planning and Design, on handoff/context loss, or owner request, record one
   consolidated decision batch using `references/decision-batch.md`: its
   quantity-definitions table and `enforced_rule`/`expected_outcome` typing; any
   gap blocks `WORKSPACE_READY` as a class C owner question. Each open
   item must be decided, owner-deferred with a trigger, justified inapplicable,
   or visibly blocked. Ask for explicit confirmation that shared understanding
   is reached when prior confirmation does not cover the current scope.
7. Update the two owned records using `templates/workspace.md` when needed and
   repository metadata rules. Preserve history, bindings, decisions, constraints,
   and gaps; label validation commands `[observed, not run]` with their sources.
   Verify the write set and hand off only when fit and material intent are settled.

Return `WORKSPACE_READY`, `WORKSPACE_RESUMED`, `NEEDS_EVIDENCE`,
`OWNER_DECISION_REQUIRED`, or `BLOCKED` with paths, scope, fit, freshness evidence,
confirmed decisions, open items, and next action. Missing facts and pending owner
answers are distinct. Resume only valid context; never start a second scope stage.
Do not implement, delete plan content, or invent retries or agent invocations.

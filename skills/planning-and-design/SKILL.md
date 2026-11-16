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

Consume confirmed alignment/scope, requirements and definitions, architecture/model
inputs, boundary and assembly contracts, SEIT, evidence, selected routes/capabilities,
cadence, authority, and repository rules. Reuse adequate sources for inactive roles;
expose missing required inputs rather than inventing them.
Any unresolved material scope, behavior, authority, risk, or
acceptance intent returns `REROUTE_SCOPE_DEFINITION` to combined alignment/scope in
this controller session; generate no `implementation.json` or Manifest and never
choose for the owner.

1. Verify settled intent and source/candidate bindings. Establish whether a
   requirements register exists; if evidence cannot decide, ask the owner. Never
   infer one; keep register references versus Lifecycle-local requirements distinct.
2. Author the technical plan and `design.md` from the completed inputs. Preserve
   registered IDs and definitions, published-standard clauses, trust boundaries, and recovery.
   Copy the confirmed quantity-definitions table into the glossary verbatim (`references/artifact-grammar.md`).
   Allocate requirements to components from the placement receipt per `references/allocation-inputs.md`.
   Author the OOPDSA Implementation Design section per `references/oopdsa-design.md`; plan programs per `references/program-planning.md`.
   Do not draft a duplicate requirements register or SEIT.
3. Build coherent bounded slices and dependency-based waves with exact write sets,
   acceptance, commands, shared resources, and serialization reasons. Tests meet
   `../test-engineer/references/shared-machine-tests.md`; engine-backed cases carry
   `resource_group`/`expected_gate_seconds`, waves `added_gate_seconds`/`resource_groups`.
   Prioritize prerequisite work and parallel ready work; avoid overloaded batches.
4. Assemble `implementation.json` and the DoD Manifest. Copy specialist-owned
   decisions faithfully per `../bearing-lite/references/planning-assembly.md`;
   choose no new roles or capability defaults. Record `planning_wave` with the
   declared enabled sessions and `review_requested`.
5. Check your own final package: run the register precheck at its final stage with
   `--seit`, every pending binding completed, then `plan-package.cjs draft`. Repair
   your owned artifacts in-session and rerun affected checks. Missing specialist
   facts stay gaps; return them to their owner, never author them yourself.
6. Requested planning review opens only after `hooks/planning-review.cjs`
   `evaluatePlanningReview()` passes its guards (`manifest_not_generated` without
   the rendered Manifest). Then obtain one integrated owner confirmation (never
   insert a profile or route pause), run the final freeze, write the handoff,
   and recommend a new Implementation Orchestrator session.

## Return and recovery

Return `READY`, `REROUTE_SCOPE_DEFINITION`, `WAITING_ON`, or
`OWNER_DECISION_REQUIRED` with candidate, paths, checks, open items, and next
action. An authorized named delta packet applies named findings only, through
`references/correction-loop.md` and `hooks/correction-delta.cjs`, within its
existing authority and allowance; specialist-owned rows return to their author.
This controller author check is not independent review or an extra agent pass.

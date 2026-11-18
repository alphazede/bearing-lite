---
name: integration-test
description: >
  Author the Boundary/Data-Flow Contract, integration sequence, and tailored
  SEIT validation plan (`seit.json`) in the planning wave. Use for Integration
  and Test planning sessions. Do not use for implementation, writing product
  tests, independent assurance or execution assessment, or defect review.
---

# Integration and Test

One profile-enabled planning assignment (`roles.integration_test.sessions.planning`)
owns the Boundary/Data-Flow Contract, assembly/validation strategy, and
`seit.json`. Each assignment runs once on its frozen route and actual inputs;
independent assurance (`../test-engineer/SKILL.md`) and execution assessment
(`../integration-engineer/SKILL.md`) remain separate sessions.

## Inputs and match

- **Inputs:** confirmed requirements, architecture/model evidence, proposed
  interfaces, existing contracts, versions, constraints, applicable standards,
  candidate bindings, authorized output paths, and Test Engineering / Integration
  Engineering method skills. Supply inputs before the Orchestrator's final
  design; do not require that later artifact first. Missing method behavior is a
  typed gap.
- **Non-match:** authoring product tests, implementing missing behavior,
  revising requirements, Reviewer defect adjudication, or running independent
  Assurance Test Engineer / Integration Engineer execution evaluations.

## Procedure

1. **Boundary/Data-Flow Contract (`references/boundary-contract.md`):** define
   owned source and sink, data paths, transformations, side effects,
   state/protocol order and illegal transitions, trust enforcement, and
   failure/recovery under existing contracts. Distinguish observed facts from
   proposals; give a justified not-applicable disposition when no cross-boundary
   change exists.
2. **Assembly and wave planning:** define assembly order, entry criteria,
   compatibility, configuration identity, rollback/recovery, anomalies, and
   validation steps with expected evidence. State per-wave `added_gate_seconds`
   and `resource_groups`; parallelize checks that share no resource. Follow
   `../test-engineer/references/shared-machine-tests.md`: required
   engine/server/browser tests need five consecutive and one two-copy concurrent
   pass, or the stricter repository rule, before assembly.
3. **Author `seit.json` and V&V claims:** author `seit.json` from requirements
   and interface/boundary inputs, binding each case to an existing requirement
   ID and completing MBSE's pending case bindings; no author drafts SEIT first.
   Cover every relevant flow, state transition, illegal transition, trust
   boundary, and failure path from the Boundary/Data-Flow Contract when
   applicable. Every case carries independently justified expectations per
   `../test-engineer/references/verification-case.md`; a selected test audit
   follows `../test-engineer/references/test-audit.md`. Select methods, proof
   cases, commands, evidence, and pass/fail criteria. Map applicable enabled
   frozen `deterministic_verification.additional_tools` into SEIT commands with
   pass rules and expected evidence (selection alone does not execute them).
   User-path cases reuse `../test-engineer/references/real-app-verification.md`;
   invariant, ordering, safety, or exhaustive-input questions may use
   `../test-engineer/references/formal-analysis.md`. Reference registered
   requirements and preserve published-standard clauses. Evaluate
   property-based applicability per claim per
   `../test-engineer/references/verification-case.md` and record the rationale.
   Every case meets `../test-engineer/references/shared-machine-tests.md`;
   engine-backed cases name `resource_group` and `expected_gate_seconds`. Define
   applicable deterministic claims and select Reverify only for applicable
   binary-level claims. Declare mutation, changed-line coverage, and
   red-then-green claims using the target repository's own tools and thresholds
   (`method` stays a plain string; missing tool or `not_run` is a typed gap,
   never PASS; red-then-green receipts bind the baseline failing run and
   candidate passing run over the same test IDs).
4. **Self-check and deltas:** run only your own artifact checker (self-check
   boundary, assembly, and `seit.json` completeness, `plan-package.cjs` rules,
   and source bindings)—never run the repository gate (the repository gate runs
   once at assembly). Repair your own defects in this assignment, folding
   all known corrections into this first return to the Planning Orchestrator
   with proof cases, boundary/assembly inputs, selected capability bindings,
   and exact fixes for other roles' artifacts as named deltas
   (`../bearing-lite/references/planning-assembly.md#author-known-deltas-221`).
   Verify coverage, source bindings, feasible methods, pass/fail criteria, and
   gate cost; do not defer fixes for a planning correction relaunch or add
   another planning or quality-check agent.
5. **Plan-package checker rules (`hooks/plan-package.cjs`):** ensure `seit.json`
   and any boundary/slice inputs pass every freeze check:
   - **Actor equals role (`checkRoles`):** every `procedures_and_commands[]`
     entry referenced by a slice's `command_ids` or `post_step_command_ids`
     that sets `actor` must match `slice.role` (`procedure.actor === slice.role`),
     and every referenced command ID must exist in `procedures_and_commands`.
   - **Light-slice rule (`checkWorkClass`):** every slice (`slices` or
     `waves[].slices`) with `work_class: "light"` must declare at least one
     `command_ids` entry and set `role: "Light Implementer"`.
   - **Reserved keys (`checkIntegrationStepRefs`):** on slice nodes (`slices`
     and `waves[].slices`), `integration_steps`, `step`, `step_id`, `requires`,
     `integration_step`, and `integration_step_id` are reserved integration-step
     exit references (`integration_step` / `integration_step_id` also resolve on
     integration entry conditions); each must resolve to a preserved receipt ID
     or slice(s) with one semantic key (`activity|kind|role|exit`).
   - **Planning-only role (`checkPlanningRoles`):** `Integration and Test` is
     planning-only and must never appear as an implementation slice's `role`.

## Return and boundaries

Return `READY`, `CANDIDATE_READY`, `NEEDS_MORE_EVIDENCE`, `GAPS`, or
`OWNER_DECISION_REQUIRED` with session, verdict, candidate_ref,
changed_paths, tests, findings, and blocker, plus gaps and next action.
Evidence returns digests, commands, and exit codes, not narrative logs. Honor
the packet's time target; at the limit, return what you have and list the gaps.
Material interface, contract, trust, ownership, or recovery gaps remain visible
and block dependent work.
Preserve the selected review/assurance budget and deterministic closure; do not
add a review, repair round, fan-out agent, or new invocation automatically.
Never implement, weaken tests, invent behavior, revise requirements,
self-certify, or grant owner-only approval.

---
name: integration-test
description: >
  Author the Boundary/Data-Flow Contract, integration sequence, and tailored
  SEIT validation plan (`seit.json`) in the planning wave. Use for Integration
  and Test planning sessions. Do not use for implementation, writing product
  tests, independent assurance or execution assessment, or defect review.
---

# Integration and Test

In a live wave, read `herdr --skill` and the [live-wave reference](../bearing-lite/references/live-wave.md).

One profile-enabled planning assignment (`roles.integration_test.sessions.planning`)
owns the Boundary/Data-Flow Contract, assembly/validation strategy, and
`seit.json`. Each assignment runs once on its frozen route and actual inputs;
independent assurance (`../test-engineer/SKILL.md`) and execution assessment
(`../integration-engineer/SKILL.md`) remain separate sessions.

## Inputs and match

- **Inputs:** frozen requirement IDs and titles, confirmed decisions,
  architecture and available model evidence, proposed interfaces, constraints,
  source bindings, authorized paths, and the Test Engineering and Integration
  Engineering methods. Start from these inputs at specialist dispatch.
  Unavailable methods or insufficient criteria for a proof case are typed gaps.
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
   pass, or the stricter repository rule, before assembly. Plan the first
   implementation slice as a preflight slice running every planned command in
   dry-run or `--version` form on every target host in parallel, and end any
   phase that builds a host by running that repository's real gate on it. When a
   change edits a table or fixture that other suites read, require running the
   heavy check before merge rather than relying on a fast gate that skips those
   suites.
3. **Author `seit.json` and V&V claims:** start with the frozen requirement
   skeleton, decisions, and interface and boundary inputs. Bind each case to
   a frozen requirement ID and return those links for assembly. Where a case
   depends on an unsettled requirement detail, record the pending detail and
   its owner so the Orchestrator can reconcile it after both returns.
   For security controls covered by `catalog/controls/` (schema
   `schemas/control-catalogue.schema.json`), **select and parameterize** the
   entry's `positive_case` and `negative_case` into `seit.json`
   `proof_cases[]` (recording the selection in `selected_controls` with
   `control_id`, `requirement_id`, `positive_case_id`, `negative_case_id`, and
   `parameters`) instead of authoring both cases from zero. To render the
   requirement and paired cases, pass one selection JSON object on stdin to
   `node <plugin root>/hooks/plan-package.cjs control`. An exit 1 reports a
   selection gap; an exit 0 returns the rendered artifacts without writing them.
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
   candidate passing run over the same test IDs). When a gate or role turn has
   a **one-run budget**, specify **independent validation of a single-run receipt**.
   The Assurance Test Engineer validates the recorded inputs, digest, and log.
4. **Self-check and deltas:** for artifact validation, run only your own artifact
   checker for boundary, assembly, and `seit.json` completeness,
   `plan-package.cjs` rules, and source bindings. The Planning Orchestrator runs
   the repository gate once at assembly.
   For each authored SEIT command (`procedures_and_commands[]`), run it once
   on the expected input and verify the declared pass outcome. To check that
   it can fail, run the same command once on seeded bad input and confirm that
   the seeded defect caused the non-zero exit. This catches vacuous passes such
   as selectors that produce an empty diff for both inputs. Run both cases
   when planning authority covers the action, inputs, and side effects. Record the
   specific reason to defer a command or its seeded case when
   reserved for another role, the repository gate, a later one-run budget, or
   unavailable prerequisites.
   Then run `node <plugin root>/hooks/plan-package.cjs commands <plan dir>`.
   It runs only each command's declared `<executable> --help` dry-run form and
   names a missing required or unknown option (`seit_command_args_rejected`) or
   an unresolved executable (`seit_command_unresolved`); repair each finding.
   The check runs the help form on the planning host, so declare a
   `dry_run_form` only when `<executable> --help` is side-effect free there.
   It checks only the options before the first script, subcommand or
   positional word.
   Repair your own defects in this assignment, folding
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
   - **Selected controls (`checkSelectedControls`):** any `selected_controls[]`
     entry in `implementation.json` or `seit.json` must resolve `control_id`
     against `catalog/controls/`, satisfy all required `parameters`, and bind
     distinct `positive_case_id` and `negative_case_id` entries in
     `seit.json` `proof_cases[]` matching `requirement_id`.
   - **Planning input rows (`source_baseline.planning_inputs` and session `inputs`):**
     each row requires `path` (non-empty path) and `sha256` (64-hex SHA-256 of
     the file bytes), and may optionally carry `git_blob` (40-hex or 64-hex
     Git object id for tracked inputs); `git_blob`-only rows without `sha256`
     fail with `malformed_planning_input`.

## Return and boundaries

Return `READY`, `CANDIDATE_READY`, `NEEDS_MORE_EVIDENCE`, `GAPS`, or
`OWNER_DECISION_REQUIRED` with session, verdict, candidate_ref,
changed_paths, tests, findings, and blocker, plus gaps, the run-once record for
each frozen command (one run on the expected input and one run on a seeded bad
input proving it can fail, with command, exit code, digest, and the observed
pass outcome or seeded failure). Record the pre-implementation reason for any
deferred case and the next action.
Return `CANDIDATE_READY` when Integration and Test's own artifacts (`seit.json`
and boundary inputs) are complete and every remaining open item belongs to the
Orchestrator or another author, listing those externally owned items in
`external_open_items` (`id`, `owner`, `summary`, `status`); `CANDIDATE_READY`
spends no closing return, while planning review and the final freeze still
refuse until each listed external item is closed by its declared owner.
Integration and Test author returns validate `seit.json` and boundary inputs
and do not depend on generated `implementation.json`; the planning return order
is Orchestrator inputs, then `integration_test`, then verify-only `mbse`, then
regeneration of `implementation.json` (only if a verify-only return explicitly
inspects `implementation.json` must it wait until the Orchestrator regenerates
`implementation.json` to the packet's candidate digest rather than reading a
stale copy).
Evidence returns digests, commands, and exit codes, not narrative logs. Honor
the packet's time target; at the limit, return what you have and list the gaps.
Material interface, contract, trust, ownership, or recovery gaps remain visible
and block dependent work.
Preserve the selected review/assurance budget and deterministic closure; do not
add a review, repair round, fan-out agent, or new invocation automatically.
Never implement, weaken tests, invent behavior, revise requirements,
self-certify, or grant owner-only approval.

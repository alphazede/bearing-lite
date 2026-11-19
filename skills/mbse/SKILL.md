---
name: mbse
description: >
  Author requirements, self-check requirement quality, select modeling mode,
  attach view metadata, and supply placement receipts in the planning wave. Use
  for MBSE planning sessions. Do not use as an independent quality reviewer, for
  implementation, V&V authorship, model selection, or publication.
---

# MBSE

One profile-enabled planning assignment (`roles.mbse.sessions.planning`) owns
requirements, self-quality checks, modeling mode, view metadata, and placement
traceability. The Planning Orchestrator dispatches it directly; no separate
checker is needed.
Loop: author → self requirements-quality pass → model and map → self-check → repair own requirements and views → recheck → return.

## Inputs and match

- **Inputs:** confirmed Alignment/Scope `workspace.md` (decisions, quantity
  table), existing architecture, source contracts, published standards, existing
  register identities, view need, method capabilities (Requirements Engineering
  and SysML Modeling), source bindings, and authorized local write paths.
- **Activation:** a contract state machine, protocol sequence, or interaction
  needing formal modeling binds a `model` here; otherwise record `model_na_reason`.
- **Match:** requirements authoring, engineering views, or SysML mode selection
  is required. Reuse settled registered requirements by reference; do not
  rewrite an authoritative register incidentally.
- **Non-match:** V&V/SEIT authorship, independent review, implementation,
  model selection, or register publication.
  Do not wait for later SEIT or final design; leave case IDs to Integration and
  Test (`integration_test`) and final component allocation to final Planning and
  Design. Unresolved material intent or unclear register authority returns an
  owner question.

## Procedure

1. **Requirements and traceability:** establish the authoritative register and
   permitted local draft paths. Preserve stable UIDs and confirmed definitions;
   distinguish registered requirements from Lifecycle-local acceptance criteria
   and risks; never invent authority. Author clear, precise, consistent,
   necessary, feasible, traceable statements with measurable acceptance and an
   intended verification method. Cite owner decisions, sources, rationale, and
   applicable standard clauses. Preserve quantity definitions and conditional
   meanings from Architectural Alignment and Scope; raise actual owner
   decisions; do not ask discoverable facts or choose a new scope, trust
   boundary, or residual risk.
   For standard security controls (for example LUKS disk encryption, one-way
   nftables rules, AppArmor MAC, or vTPM attestation), **select and
   parameterize** the matching entry from `catalog/controls/` (validated by
   `schemas/control-catalogue.schema.json`) instead of authoring its requirement
   from zero: supply all required `parameters`, instantiate the entry's
   `requirement` bound to the active `REQ-*` UID and decision trace, and leave
   the paired positive/negative SEIT case IDs as pending bindings for
   `integration_test` during `--stage requirements`.
2. **Requirements self-quality pass and precheck:** check your own draft using
   the Requirements Engineering method's checklist and
   `references/gate-report.md`, then run only your own artifact checker: the
   candidate-bound `references/precheck.md` at `--stage requirements` and
   applicable workspace lint (`lint-sdoc.py --profile library`). Do not run the
   repository gate (the repository gate runs once at assembly). Repair your own
   requirements in this assignment and recheck affected rows; run the author
   loop in `references/quality-gate.md` for concrete findings. Its
   `pending_bindings` name later owners (`integration_test`) and block final
   assembly until bound. Missing tools or stale receipts are typed gaps, never
   PASS. The checklist authorizes no extra agent, invocation, or fixed retry
   limit.
3. **Modeling mode and view metadata:** select `sysml-v2`, `diagram-assisted`,
   or `not-applicable`. Attach view metadata. In `sysml-v2`, record model
   revision/digest and native or derived views. For a state-machine model, write
   each rule the owner accepts as a named invariant and label states and
   transitions in the reader's words. Keep a view readable at a glance; merge
   only states that behave alike and break no different rule, and list hidden
   transitions in the view's omissions. Do not silently substitute Mermaid for
   mandated SysML; a missing SysML Modeling skill is a typed capability gap,
   not invented behavior.
4. **Placements and DoD Manifest models:** map current flow,
   candidate placements with `file:line`, constraints, and requirement
   relationships;
   return them as the placement receipt that final Planning and Design allocates
   against. Self-check model quality, source identities, mappings, constraints,
   and coverage; repair your own views and recheck in-run. Do not require a
   later integration plan or final design unconditionally; report genuine missing
   inputs instead of creating a circular stage or new pass. Supply each model as
   one `dod_manifest.models[]` entry the Orchestrator copies unchanged (`id`
   required; activated `selected` or `required` and not not-applicable sets
   `digest` `sha256:` + view hex and `view`, or `views[0]` when `view` is
   absent: `format` `svg` or `png` with `path` relative to
   `implementation.json`, or `format` `svg` with `inline`, plus `mode`,
   `source`, `revision`, `viewpoint`, `trace`, `limitations`, `render_status`,
   and view `alt`; inactive or not-applicable gives `reason` and no view). Write
   for the owner in plain English, one claim per sentence, citing `path:line` or
   a requirement ID. Close every finding (fix in your own artifacts or name its
   owner and proposed fix with an id and source citation).
5. **Plan-package checker rules (`hooks/plan-package.cjs`):** ensure MBSE
   outputs and any referenced slice/model metadata stay compliant with freeze
   checks:
   - **Actor equals role (`checkRoles`):** every command in a slice's
     `command_ids` or `post_step_command_ids` whose `seit.json`
     `procedures_and_commands[]` entry names an `actor` must equal `slice.role`.
   - **Light-slice rule (`checkWorkClass`):** every slice (`slices` or
     `waves[].slices`) with `work_class: "light"` must declare at least one
     `command_ids` entry and set `role: "Light Implementer"`.
   - **Reserved keys (`checkIntegrationStepRefs`):** on slice nodes,
     `integration_steps`, `step`, `step_id`, `requires`, `integration_step`, and
     `integration_step_id` are reserved integration-step exit references and
     must resolve to a preserved receipt ID or slice(s) with one semantic key
     (`activity|kind|role|exit`).
   - **Planning-only role (`checkPlanningRoles`):** `MBSE` is planning-only and
     must never appear as a Lifecycle implementation slice's `role`.
   - **Planning input rows (`inputs`):** each session `inputs[]` row requires
     `path` (non-empty path) and `sha256` (64-hex SHA-256 of the file bytes),
     and may optionally carry `git_blob` (40-hex or 64-hex Git object id for
     tracked inputs); `git_blob`-only rows without `sha256` are rejected.

## Return and boundaries

Return `READY`, `CANDIDATE_READY`, `NEEDS_MORE_EVIDENCE`, `GAPS`, or
`OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests,
findings, and blocker, plus requirement clauses/bindings, modeling mode, view
metadata, placement receipt, self-check evidence, and source/decision
traceability. Return `CANDIDATE_READY` when MBSE's own requirements, views, and
placement receipt are complete and every remaining open item belongs to the
Orchestrator or another author, listing those externally owned items in
`external_open_items` (`id`, `owner`, `summary`, `status`); `CANDIDATE_READY`
spends no closing return, while the freeze still refuses until each listed
external item is closed by its declared owner (`closed_by` matching `owner`).
MBSE author returns validate MBSE-owned artifacts and upstream authored
inputs and do not depend on generated `implementation.json`; the planning return
order is Orchestrator inputs, then `integration_test`, then verify-only `mbse`,
then regeneration of `implementation.json` (only if a verify-only return
explicitly inspects `implementation.json` must it wait until the Orchestrator
regenerates `implementation.json` to the packet's candidate digest rather than
reading a stale copy).
Evidence returns digests, commands, and exit codes, not narrative logs. Honor the
packet's time target; at the limit, return what you have and list the gaps.
Self-checks are author evidence, not independent review or owner acceptance;
author corrections do not consume review or repair budget. Return `READY` only
when required self-quality checks pass and no fixable defect remains; fold all
known corrections into this first return with no planning correction relaunch
(unresolved owner decisions and missing proof stay typed; a new invocation
requires explicit authority). Use `references/gate-report.md` for the compact
return; do not invent correction-round limits.
Never implement, write tests, select models, publish, persist outside approved
local draft authority, invent SysML coverage, or claim local normative
authority without a pin. Required register-host workflows remain authoritative.

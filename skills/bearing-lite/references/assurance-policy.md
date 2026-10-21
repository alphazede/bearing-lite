# Assurance budget policy

Decision source: `DEC-BDL-007`, `DEC-BDL-030`, `DEC-BDL-047`, `DES-BDL-007`.

Cadence values are `slice`, `phase`, or `lifecycle`. Defaults are `phase`
for Test Engineer assurance, `phase` for Reviewer, and `lifecycle` for
Integration Engineer execution. A declared boundary runs each enabled
session once, allows one aggregated repair, then uses deterministic closure
without automatic rereview. `hooks/assurance-budget.cjs` is the exact
runtime mirror of the block below; the block is authoritative.

```json
{
  "gate_order": ["build", "types_lint", "red_then_green", "mutation", "changed_line_coverage", "reverify", "reviewer"],
  "numeric_score_gates": ["mutation", "changed_line_coverage"],
  "mixed_cadence_reviewer_consumption": "consume the most recent gate-chain receipt for the unit when no TE receipt exists at the boundary; the gate chain therefore runs at every Reviewer boundary",
  "budget_scope": "per_declared_cadence_unit",
  "cadence_values": ["slice", "phase", "lifecycle"],
  "default_cadence": {
    "test_engineer.assurance": "phase",
    "reviewer": "phase",
    "integration_engineer.execution": "lifecycle"
  },
  "review_rounds": 1,
  "aggregated_repairs_max": 1,
  "post_repair_gate": "deterministic_PASS",
  "automatic_phase_or_wave_end_review": "required",
  "automatic_per_slice_review": "cadence_gated",
  "post_repair_rereview": "prohibited",
  "automatic_rereview_of_same_unit": "prohibited",
  "budget_reset_on_candidate_change": false,
  "budget_reset_on_model_change": false,
  "budget_reset_on_harness_change": false,
  "budget_reset_on_role_change": false,
  "budget_reset_on_session_change": false,
  "budget_reset_on_resume": false,
  "budget_reset_on_alias_or_rename": false,
  "budget_reset_condition": "next_distinct_declared_phase_or_wave_present_in_the_frozen_declaration"
}
```

## Unit identity

Budget identity is `lifecycle + unit_kind + unit_id`. The unit id is resolved
from the frozen declaration from its declared identity (phase aliases for a wave resolve to that same wave):
`slices[].id` for slice, `waves[].id` else `phases[].phaseId` for phase or
wave, `journey_settings.lifecycle_id` for lifecycle, else the single `direct`
sentinel when neither waves nor phases are declared. A unit id absent from the
frozen declaration fails closed as `undeclared_review_unit`; renaming a
declared unit's display name never mints a fresh budget.

When the frozen declaration carries `journey_settings.review_rounds` (every
package frozen under the planning-wave contract), that per-unit declaration is
the budget source for wave and phase units: one row per declared unit plus
`planning`, each one Reviewer round, at most one repair, deterministic closure.
An invalid declaration returns `review_round_declaration_invalid`; the
`planning` unit never answers an implementation request. `hooks/plan-package.cjs`
freezes the same rows, so there is no second source of truth.

Slice-scope review is allowed only when the frozen cadence for that session
is `slice`. Default `phase` cadence rejects automatic per-slice review.
Lifecycle-end wording where `phase` cadence applies is a contract failure.

The budget key
records no route, provider, model, harness, account, or agent identity.
Candidate revision, lease generation, assigned role, session, and a non-unit
`slice_id` field are likewise never key components, and none of them lowers a
spent count. A declared slice or lifecycle unit retains its spent budget
under the same `unit_kind` + `unit_id` key.

## Spending the budget

- One review round per declared cadence unit (slice, phase or wave, or
  lifecycle). A second round on the same unit
  halts with `assurance_round_limit`.
- A repairable verdict permits at most one aggregate repair. Aggregate findings
  before that repair; role packets share the bound. A second repair
  halts with `assurance_repair_limit`.
- After that repair the parent controller closes the unit on a deterministic
  `PASS` gate (Orchestrator on a direct packet, Coordinator on a coordinator
  wave); a missing or non-`PASS` gate halts with
  `deterministic_post_repair_gate_required`.
- The repaired unit is never reviewed again. `automatic_rereview_requested` and
  `review_after_repair` both require an owner amendment.
- Before reservation, a transport receipt of `WAITING_ON`, `UNAVAILABLE`, or
  `not_run` returns `NEEDS_MORE_EVIDENCE`. Once a native launch is reserved,
  failure or missing transport evidence never refunds the allowance. A reserved
  slot is not a passing assurance result.
- The next distinct declared phase or wave carries its own budget. Declared
  slice and lifecycle units likewise retain their spent counts.

## Dispatch timing (#222)

The owner requests independent review and assurance once, at the integrated
plan approval, by freezing each session's scope and cadence. That frozen
request is the dispatch authority for every declared boundary;
`automatic_phase_or_wave_end_review: "required"` means the parent controller
does not ask again.

- As soon as a declared unit's integrated candidate passes its deterministic
  checks, the parent controller (Coordinator on a coordinator wave,
  Orchestrator on a direct packet) dispatches every requested session for that
  boundary. It never waits for a later wave, batches several units into one
  review, or defers the review to lifecycle end.
- When waves are declared, `phase` cadence resolves to each wave (see Unit
  identity). The default therefore reviews at every wave end, and no separate
  `wave` cadence value is needed.
- A session the owner did not request stays inactive. Profile configuration
  alone requests nothing.
- When dispatch is unavailable at the boundary, record `WAITING_ON` for that
  unit and dispatch on recovery. The waiting review never counts as passed,
  and ready work continues meanwhile.
- Landing follows closure (`task-state.md#landing-a-closed-unit`). A unit with
  requested review is not landed before its round closes.

## Planning review stays separate

Planning review is a separate pre-dispatch gate with its own 1/1 allowance in
`references/review-policy.md`. It never consumes implementation
`required_assurance`, `assurance_rounds`, or `max_assurance_rounds`, and this
budget never consumes the planning gate.


## Mandatory bound dispatch (#209 / #210)

The parent controller binds the supported assurance flow before any provider
launch. This is a dispatch contract, not a new planning stage or owner gate.
In a root-level visible Markdown plan, record one line (paths relative to that
plan directory; substitute the actual frozen declaration hash):

```text
- assurance_dispatch: {"journey":"J","declaration_path":"implementation.json","declaration_sha256":"<sha256 of frozen declaration>","task_record_path":"task-record.json"}
```

The declaration's `journey_settings.lifecycle_id` must match `journey`.
`journey_settings.assurance_dispatch.slots` lists the exact native tool name
and full `tool_input` object for each authorized launch, plus `id`, `kind`,
`group`, `unit_id`, `candidate`, and `scope`. Kinds are `review` (all declared
sessions within the assurance round), `repair`, `deterministic`, and
`qualification`. Freeze the existing routes and capabilities, including
`review.coverage_assist` and `deterministic_verification.reverify`, as usual;
this barrier neither chooses routes nor replaces their qualification.

Slots in one explicitly approved parallel `review` group share the same unit,
candidate and scope. They consume one round and each slot can launch once.
One slot may itself be the authorized complete bounded child invocation;
never place an unbounded loop, automatic retry, or additional provider sampling
inside it. The barrier accounts for tool launches, not arbitrary subprocesses
inside an approved command. A command must have a bounded launch contract.
Parent controllers must not delegate unrestricted provider access inside a slot.

Initialize the existing visible task record explicitly, preserving any prior
counts. Every dispatched unit must already have both nonnegative integer
`assurance_rounds` and `assurance_repairs`. The record carries `journey`,
`units`, `dispatch_log: []`, and `amendments: []`. Each unit's `receipts` holds
the latest actual gate-chain evidence; Reviewer consumes its most recent
`gate_chain` `PASS` as before. Missing units, missing counters, `{}`, malformed
JSON, changed frozen bytes and invalid record identities refuse dispatch.
Legacy evaluator inspection still permits an explicitly empty `units` list
for the next unspent unit; native dispatch requires explicit initialization.
No in-progress plan is migrated automatically.

`hooks/assurance-dispatch.cjs` is registered without a tool matcher on the
common, Cursor and Copilot pretool paths. Bound shell/agent/unknown launches
must match a frozen slot; changing tool metadata, packet names, model, harness,
session, activity or candidate cannot authorize a second launch. Read, edit,
and owner communication tools remain available; other executable status or
rollback commands need their own bounded frozen slot. An explicit root task in `EVIDENCE_READY`, `VALIDATING`, `REVIEWING` or
`ACCEPTANCE` with nonempty required assurance refuses executable dispatch if
the binding is missing. Read/edit/owner tools stay available to recover.
Without a binding or such a task, ordinary work remains outside this contract. The plan, declaration, authority
and task record are parent-controlled inputs, not adversarial tamper-proof
storage; removal of the binding or direct rewriting of history violates that
same authority boundary. Host plugin disablement and failure to run a hook
cannot be enforced by a package hook.

The hook atomically takes an adjacent task-record lock, evaluates the shared
budget, reserves and increments before returning allow. It fsyncs a temporary
file, renames it over the same visible record, then fsyncs the directory.
`dispatch_baseline` preserves original expenditure; `dispatch_log` appends slot,
unit, group, candidate, scope, launch hash, time and result `RESERVED`.
`dispatch_declaration_sha256` binds further claims to the same declaration.
No hidden ledger, service or process survives the invocation. Concurrent
claims serialize; unavailable locks are typed gaps and deny the launch.
A crash-held lock is not auto-stolen: the parent confirms no writer remains,
inspects the visible record and removes only that stale lock. Ambiguous
launch outcomes stay reserved; never retry a claimed slot automatically.

The parent appends actual role results to each reserved log entry without
replacing the reservation. `not_run`, `WAITING_ON`, `UNAVAILABLE`, `RESERVED`
or absent results never pass. Repair requires all approved slots in the
opened group to return closed results with a `REPAIR_REQUIRED` result, then
consumes the one repair before launch. Deterministic closure requires the
repair's `PASS`, then records its own actual `PASS` and the unit's
`deterministic_gate: "PASS"`. This does not dispatch another general review.
All previously required verification and independent acceptance remain.

## Explicit bounded amendment and qualification

`node <plugin root>/hooks/assurance-dispatch.cjs --amend` reads a proposed
amendment from stdin in the project root. It does not ask for or create owner
authority. Required fields are `id`, `unit_id`, `scope`, `candidate`,
`additional_rounds`, `additional_repairs`, `slot_ids`, and `authority_path`.
The slots must already exist in the frozen declaration; unlisted slots and
scope changes need a new explicit authority decision, never an automatic reset.
The referenced existing visible authority envelope must be active/effective,
name the owner decision in `granting_owner_decisions`, carry an owner
`approval_receipt` with matching `decision_id`, and allow the exact action and
scope without prohibiting it. Its `subject` binds `journey`, `unit_id`,
`candidate`, and `assurance_budget_amendment` containing the exact additional
counts and slot IDs. An event's `owner_approved` flag grants nothing.
The hook appends the amendment with the authority hash and timestamp and
preserves every original counter, reservation and baseline. Duplicate IDs,
reused slots, changed authority bytes and excessive allowances refuse.

Qualification is single-use and requires a frozen `qualification` slot with
`subject` and `authority_id`. The declaration's `assurance_dispatch.authorities`
entry binds that ID to a local authority path and hash. The envelope must
allow `assurance_qualification`; its subject's `assurance_qualification` binds
the exact qualification subject and `launch_sha256` (SHA-256 of the sorted-key
JSON object `{tool_name,tool_input}`). The parent checks the genuinely bounded
qualification purpose before freezing; renaming a review in a tool payload
cannot change a slot's kind. Qualification creates a reservation, consumes no
review/repair allowance, and never establishes independent assurance PASS.

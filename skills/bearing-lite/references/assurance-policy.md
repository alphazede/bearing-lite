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
from the frozen declaration according to the requested cadence unit kind:
`slices[].id` for slice, `waves[].id` else `phases[].phaseId` for phase or
wave, `journey_settings.lifecycle_id` for lifecycle, else the single `direct`
sentinel when neither waves nor phases are declared. A unit id absent from the
frozen declaration fails closed as `undeclared_review_unit`; renaming a
declared unit's display name never mints a fresh budget.

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
- A transport receipt of `WAITING_ON` or `UNAVAILABLE` is not a spent round; it
  returns `NEEDS_MORE_EVIDENCE`.
- The next distinct declared phase or wave carries its own budget. Declared
  slice and lifecycle units likewise retain their spent counts.

## Planning review stays separate

Planning review is a separate pre-dispatch gate with its own 1/1 allowance in
`references/review-policy.md`. It never consumes implementation
`required_assurance`, `assurance_rounds`, or `max_assurance_rounds`, and this
budget never consumes the planning gate.

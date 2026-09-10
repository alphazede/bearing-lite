# Assurance budget policy

Decision source: `OWNER-EMV-REVIEW-CADENCE-UNIFICATION-001` through
`ROUTER-EMV-CADENCE-IMPLEMENTATION-001`.

The implementation assurance budget is scoped to each **declared phase or
wave**, not to the Journey and not to a slice. Automatic review is dispatched
at the end of each declared phase or wave. `hooks/assurance-budget.cjs` is the
exact runtime mirror of the block below; the block is authoritative.

```json
{
  "budget_scope": "per_declared_phase_or_wave",
  "review_rounds": 1,
  "aggregated_repairs_max": 1,
  "post_repair_gate": "deterministic_PASS",
  "automatic_phase_or_wave_end_review": "required",
  "automatic_per_slice_review": "prohibited",
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

Budget identity is `journey + unit_kind + unit_id`. The unit id is resolved
from the frozen declaration: `waves[].id`, else `phases[].phaseId`, else the
single `direct` sentinel when neither is declared. A unit id absent from the
frozen declaration fails closed as `undeclared_review_unit`; renaming a
declared unit's display name never mints a fresh budget.

The budget key
records no route, provider, model, harness, account, or agent identity.
Candidate revision, lease generation, assigned role, session, and
slice id are likewise never key components, and none of them lowers a spent
count.

## Spending the budget

- One review round per declared phase or wave. A second round on the same unit
  halts with `assurance_round_limit`.
- A repairable verdict permits at most one aggregate repair. A second repair
  halts with `assurance_repair_limit`.
- After that repair the coordinator closes the unit on a deterministic `PASS`
  gate; a missing or non-`PASS` gate halts with
  `deterministic_post_repair_gate_required`.
- The repaired unit is never reviewed again. `automatic_rereview_requested` and
  `review_after_repair` both require an owner amendment.
- A transport receipt of `WAITING_ON` or `UNAVAILABLE` is not a spent round; it
  returns `NEEDS_MORE_EVIDENCE`.
- The next distinct declared phase or wave carries its own budget.

## Planning review stays separate

Planning review is a separate pre-dispatch gate with its own 1/1 allowance in
`references/review-policy.md`. It never consumes implementation
`required_assurance`, `assurance_rounds`, or `max_assurance_rounds`, and this
budget never consumes the planning gate.

# Planning review policy

This machine-readable block is the single declarative authority for
planning-review constraints. `hooks/planning-review.cjs` exports its runtime
mirror; focused tests require an exact match. Changing these bounds needs
an explicit owner amendment. This policy records no route, provider, model,
harness, account, or agent identity.

```json
{
  "reviewer_slots_min": 1,
  "reviewer_slots_max": 1,
  "independence_required": true,
  "isolated_findings_until_aggregation": true,
  "candidate_fields": ["candidate_ref", "candidate_revision", "candidate_digest"],
  "shared_candidate_required": true,
  "review_rounds": 1,
  "aggregated_repairs_max": 1,
  "post_repair_gate": "deterministic_PASS",
  "automatic_rereview": "prohibited",
  "slot_exhaustion_outcome": "FAIL_ROUND",
  "terminal_outcomes": ["HALT", "OWNER_AMENDMENT_REQUIRED"],
  "planning_unit_id": "planning",
  "planning_sessions_required": ["planning_and_design", "integration_engineer", "test_engineer"],
  "planning_sessions_optional": ["requirements_engineer", "systems_modeler"],
  "planning_session_pending_verdicts": ["WAITING_ON", "UNAVAILABLE", "RUNNING"],
  "requires_regate_rounds_max": 1
}
```

Planning is one wave with unit id `planning` and the same 1/1 budget as an
implementation wave. Every declared planning session (the required three plus
any selected or required optional session) returns before the one review opens;
a session verdict, including a Requirements Engineer failure, is a review
input, never a gate between sessions. `requires_regate_rounds_max` bounds the
named correction loop to that one aggregated repair; a further `requires_regate`
finding returns `NEEDS_OWNER_DECISION`. Details:
`../../plan-integrator/references/planning-wave.md`.

Planning and Design writes the separate Lifecycle binding in the approved profile
snapshot. It lists unique abstract `slot_id` values, each slot's owner-selected
`primary_route_ref`, and ordered `fallback_route_refs`. Each receipt records a
distinct selected route from its slot. All receipts bind to the same non-empty
candidate ref, revision, and digest. Exhausting any slot
returns `FAIL_ROUND`. Candidate or independence mismatch, a second round or
repair, or a missing deterministic PASS after repair returns `HALT`. Automatic
confirmation or rereview returns `OWNER_AMENDMENT_REQUIRED`.

This gate reviews planning artifacts before dispatch. It never invokes a
reviewer. Implementation assurance remains governed separately by
`max_assurance_rounds` and task `required_assurance` / `assurance_rounds`.

Owner presentation and continuation follow `owner-stops.md`: one integrated
gate includes the bounded grant, first-approval summary or revision diff, open
decisions, and access to the full frozen package. This adds no reviewer,
review round, or approval checkpoint and does not alter the bounds above.

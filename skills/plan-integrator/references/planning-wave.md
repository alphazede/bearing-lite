# Planning wave

Planning is one wave: unit id `planning`, reviewer `cadence: phase`, and the
same budget as an implementation wave, `max_assurance_rounds` 1 per wave: one
consolidated review, at most one aggregated repair, then deterministic closure.
The bounds and session names live in `../../bearing-lite/references/review-policy.md`
(runtime mirror `hooks/policy.cjs`). This applies to future planning only;
packages frozen before this contract stay historical and are never migrated.

## Sessions

`journey_settings.planning_wave.required_sessions` names every session of the
wave: always `planning_and_design`, `integration_engineer`, and
`test_engineer`; plus `requirements_engineer` and `systems_modeler` when
selected or required. Unknown or duplicate names fail closed.

Sessions run in dependency order of their inputs, never behind a verdict:

| Session | Consumes | Returns |
| --- | --- | --- |
| Systems Modeler contextual pass | settled intent, repository | placement receipt |
| Planning and Design | decisions, placement receipt | plan, `design.md`, draft `seit.json`, register rows, graph |
| `hooks/register-precheck.cjs`, then Requirements Engineer | draft register and plan | precheck receipt; typed register findings |
| Integration Engineer planning | drafts, architecture map | Boundary/Data-Flow Contract, assembly strategy |
| Systems Modeler model pass | drafts, boundary contract | model views and mappings |
| Planning Test Engineer | drafts, boundary contract | final `seit.json` |

No session waits on a Requirements Engineer `PASS`; a failing precheck or
register verdict is review input and sends nothing back mid-wave. The author's
ordinary drafting corrections before the review are initial work and spend no
repair. A session that cannot proceed returns a typed gap, which the review
and owner gate see.

## One review, one repair, deterministic closure

1. Generate `implementation.json` with `journey_settings.review_rounds` (one row
   per declared wave or phase plus `planning`) and `planning_wave`, then run
   `node <plugin root>/hooks/plan-package.cjs draft <plan dir>`; it must PASS
   before the DoD Manifest renders.
2. `hooks/planning-review.cjs` opens the review only when every declared session
   has returned for the candidate ref (`planning_sessions_incomplete` otherwise).
3. The one consolidated review aggregates, in one findings list: the
   independent Reviewer slot, precheck findings, Requirements Engineer findings,
   and, only when the frozen `review.coverage_assist` selection enables it, a
   read-only coverage pass run in parallel. Disabled coverage assist leaves
   coverage with the Reviewer; selected but unavailable is a typed gap. Coverage
   assist never replaces the Reviewer or its independence.
4. One aggregated repair applies that list through named deltas
   (`../../planning-and-design/references/correction-loop.md`). `exact_text`
   closes mechanically; the `requires_regate` rows spend the one round and are
   never re-gated by another Requirements Engineer review; a further
   `requires_regate` finding returns `NEEDS_OWNER_DECISION`.
5. Deterministic closure: the draft freeze and correction-delta receipts PASS on
   the repaired candidate. No re-review.
6. Record the wave receipt in `journey_settings.planning_wave`: `sessions`
   (`session`, `candidate_ref`, `verdict`), `reviews: 1`, `repairs` 0 or 1,
   `closure: "deterministic_PASS"`, and the closing `candidate_digest`. Then
   `node <plugin root>/hooks/plan-package.cjs <plan dir>` (final) must PASS; it
   is the precondition for the owner gate and implementation dispatch.

## Reusing verification receipts

A deterministic receipt (precheck, correction delta, freeze, lint) is reused
while every input it binds is byte-identical by digest. After the repair, rerun
only checks whose inputs the repair changed plus the required final gates (the
final freeze). Review and landing share a qualified receipt bound to the same
candidate digest. A receipt whose bound digest no longer matches is stale and
never reused; reuse never weakens or skips a check.

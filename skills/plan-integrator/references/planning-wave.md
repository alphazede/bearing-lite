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
   has returned for the candidate ref, revision, and digest
   (`planning_sessions_incomplete` otherwise). Digest-bound adoption of unchanged
   inputs is mechanical, as below; it never invents a fresh specialist return.
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
6. Preserve the original completed planning-review input JSON as evidence under
   the plan directory, for example `gate-evidence/planning-review.json`. It is
   evidence, not a sixth canonical artifact. It retains the reviewed `candidate`
   (ref, revision, digest), original `planning_wave` sessions, Reviewer slot and
   candidate-bound independent `receipts` (including a terminal `verdict` of
   `ACCEPT`, `PASS`, or `REPAIR_REQUIRED`), `round_number: 1`,
   `completed_rounds: 1`, `aggregation_complete: true`, and
   `aggregated_repairs: 0`. Preserve its `dod_manifest.output_name`; the rendered
   manifest must exist. Final freeze resolves its plan-relative path and SHA-256
   and calls the existing planning-review evaluator; counters alone never suffice.
7. Record `journey_settings.planning_wave.review_receipt: {path, sha256}`,
   `reviews: 1`, `repairs` 0 or 1, `closure: "deterministic_PASS"`,
   `closing_candidate` (ref, revision, digest), and its matching `candidate_digest`.
   Preserve the original reviewed `required_sessions` and `sessions` verbatim.
   Without a repair the closing identity equals the reviewed identity. With one
   repair, add `repair: {from_candidate, to_candidate, deterministic_gate: "PASS"}`:
   from is the immutable reviewed identity; to is the closing identity whose
   input digests the final freeze verifies. Record PASS only after the affected
   deterministic checks pass. Never rewrite the original independent receipt or
   specialist identities to the repaired hashes, and never rerun review. Then
   `node <plugin root>/hooks/plan-package.cjs <plan dir>` (final) must PASS; it
   is the precondition for the owner gate and implementation dispatch.

## Specialist input adoption

Each session return carries `session`, `candidate_ref`, `candidate_revision`,
`candidate_digest`, and `verdict`. If its identity differs from the review
candidate, keep those source fields and its original consumed `inputs` list of
`{path, sha256}`. Record `adopted_to` with the complete target identity.
The review input records `input_digests`: the actual planning-input path/hash
rows in SEIT baseline order, followed by the `seit.json` path/hash row. Hashing
those SHA-256 values joined with newlines must reproduce the target manifest
candidate digest. Every consumed input must resolve with its unchanged hash in
that bound snapshot; absent, stale or invented inputs block adoption. Capture
this snapshot from the passing draft freeze's verified inputs, not from desired
hashes. Preserve it with the original review record even when repair changes a
closing input; it describes what was reviewed, not a claim that old inputs are
still current. Unchanged-input adoption spends no specialist or review round.

## Reusing verification receipts

A deterministic receipt (precheck, correction delta, freeze, lint) is reused
while every input it binds is byte-identical by digest. After the repair, rerun
only checks whose inputs the repair changed plus the required final gates (the
final freeze). Review and landing preserve the qualified original review receipt and explicit
one-repair lineage to the closing digest. Deterministic receipts bind their
actual inputs: changed inputs invalidate those receipts; unchanged inputs
permit reuse. This never turns a stale receipt into independent PASS on new
bytes and never weakens or skips a check.

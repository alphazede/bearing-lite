# Assurance bounded test-side repair

When the frozen profile preauthorizes it, the Assurance Test Engineer may
repair proven test-side defects in the same session, reusing the Reviewer's
contract in `../../reviewer/references/repair-transition.md` — the same
`repair_transition` in `.bearing-round.lock`, not a second mechanism.

## Preauthorization

The parent records `repair_transition` only when the frozen snapshot carries
`assurance_repair: { enabled: true }` (schema: `schemas/profiles.schema.json`;
frozen by `hooks/profiles.cjs`). The record carries `authorization: advance`,
`repairs_max: 1`, exact test-side `write_set`, same lineage (`worktree`,
`branch`, `generation`), same assurance context, and a receipt persisted
before mutation. The receipt's write set must stay inside the advance grant.

Without the profile authorization, behavior is unchanged: preserve the
candidate and return `FAIL` with findings. No repair round is added.

## Scope

Allowed paths are tests, fixtures, test helpers and test configuration.
Product code stays out of scope; a product defect still returns `FAIL` to
the Orchestrator.

No assertion is weakened, skipped, deleted or filtered, and no retry may
hide a flaky test. The fix removes the cause of the flakiness.

Each repair carries a red-then-green reproduction, for example repeated
runs that show the flake before and stable passes after.

## Closure and budget

Deterministic verification decides after the repair, not the Assurance Test
Engineer's own verdict, so assurance stays independent of its own fix. The
parent consumes the candidate-bound deterministic `PASS`; the ATE never
self-certifies.

One repair per assurance round; budgets and review cadence are unchanged
(per `../../bearing-lite/references/assurance-policy.md`: one round, at most
one aggregate repair, deterministic closure without another review). Failed
repair, scope growth, or exhausted allowance returns to the owner without
resetting budgets.

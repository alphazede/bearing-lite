# Bearing 3.0 replay

On 2026-11-18 the Bearing Lite implementation team measured the recorded baseline workload. No candidate arm was replayed. No default is promoted. This report promises no savings.

## Decision claim

Keep every current default. The result that would change the decision is a promote report on paired runs of this same workload, with preserved checks, detection of seeded defects, no authority or write-set violations, and fewer median fresh tokens per integrated slice. The assurance rerun must confirm the result.

## Workload

Workload digest: `8e12042060636a2905de7272afed8d9e5111797deedb305f2b42493d9c11f2d4`.
Package digest, recorded before the profiler run: `37c7a5f4ef50a9723a6ef8007922651249df00f91bed6f447c5031226b15ad4e`.
One package was frozen. There is no separate package for variants B, C, or D.

## Coverage gaps

The frozen population has no task-size field, so the 12 size-by-stage cells were not drawn.
Completed journeys by stage: {"assurance": 0, "implementation": 5, "planning": 4, "review": 1}.
Profiler-tracked journeys: 1 of 38.
Paired repetitions were not run. Candidate receipt directories were empty.
The dispatch study stopped after the labelled sample fell below the minimum needed to evaluate the decision arm. No dispatch arm proceeds.

## Benchmark-evidence method

A comparison requires repeated alternating runs of both arms. The team collected baseline measurements only, so it could not identify a candidate bottleneck or estimate a change in performance.

## Promotion

Each candidate default was evaluated with the promotion rule. Exit code 0. Decision `no_promote`. Recommendation `keep_current_default`.

- arm-b-deterministic: no_promote; reasons missing_evidence.
- arm-c-decision-routing: no_promote; reasons missing_evidence.
- arm-d-specialist-escalation: no_promote; reasons missing_evidence.
- egm: no_promote; reasons missing_evidence.
- handoff-compiler: no_promote; reasons missing_evidence.
- orchestrator-cost: no_promote; reasons missing_evidence.
- prompt-structure: no_promote; reasons missing_evidence.
- pstack: no_promote; reasons missing_evidence.

Rollout: do not change a default on this report.
Rollback: no default was switched, so there is no last-good config to restore. Task budgets stay as they are.

## Measures

Variants A, B, C, and D, for every replay measure: unavailable (no paired candidate run). Inference overhead, cache effects, errors, and rework are included in that unavailable set, not omitted.

Recorded-workload cohort from the profiler, one identical pair of passes, not a variant comparison:

- tokens_per_completed_journey: unavailable (no_completed_journey).
- tokens_per_integrated_slice: unavailable (no_merged_slice).

Role totals from the same profile. A role is omitted when it had no usage row. Unqualified or partial rows stay unavailable.

- test-engineer: model_calls 39; fresh_tokens 232310; cache_read_tokens 4437738.
- unattributed: model_calls 679; fresh_tokens 6645038; cache_read_tokens 140570834.

Usage rows: {"bound": 2, "unattributed": 10}. Tracked journeys in the profile: 1.

Orchestrator model calls and cache-read tokens were not compared on paired repetitions of one planning session. No reduction is claimed.

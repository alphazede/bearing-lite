# Program Planning

Plan only. Never write product code, change scope, or create issues or milestones without owner yes.

## Inputs

- Approved spec with stable REQ/AC IDs, owner decisions, deadline, appetite.
- Resources: tools, hardware, locks with capacity (editor, scene, GPU, review queue), routes, cap (repo rule, else 5). Owner hours only if supplied.
- Replan: plan and `plan_rev`, verified ledger, active delegates, spent review/repair counts, notices.
- Missing input: `NEEDS_EVIDENCE`. Never invent.

## Initial plan

1. Coverage: map every REQ, AC and source topic to a package, existing evidence, or owner deferral (decision, trigger). A silent spec gets `MISSING_INFO`, not a guess.
2. Split a package with separately acceptable outcomes, several disciplines, an open interface, an integration boundary, mixed locks, research mixed with bulk work, or steps needing TBD. Stop at one red-green cycle, shared sequential state, dense tool use, or handoff cost above the work.
3. Contract each package with every contract field below.
4. Graph: hard vs preferred edges. Interface task before fan-out; risk probes before bulk content; owner gates hard; one integration task closes each fan-out. Run parallel only with a baselined interface, disjoint write and lock sets, separate worktrees, workers reporting only to the planner, and review queue under its limit (default 2).
5. Milestones: name the artifact from the ladder, entry, exit evidence, proves, unproven, integration owner; end with a verification gate. A slice or recording never proves completion. Bulk content waits for second-asset timing.
6. Estimate agent O/M/P per bucket bottom-up from the task's steps; record `estimate_basis`, scope review lock via `lock_buckets`; cold-start priors are assumptions. Run the repository forecast tool on the plan. Quote percentiles only from it. Keep estimate, appetite and commitment (P80) apart. Infeasible: list exact unmet AC.
7. Write the plan files, draft issues and milestones; do not create them. Asset packages cite their export pre-flight check. Keep automated, manual UI and human evidence apart; keep owner-agreed margins.

## Replan

Classify each trigger by notice class. Assumption: ledger plus probe. Product defect: bug triage. Scope: owner.
Take the smallest tier: 1 local ruling; 2 resequence in float; 3 split or merge unfinished; 4 recalibrate when `calibration.raw` leaves 0.85-1.15; 5 plan defect: version the interface, add adapter task; 6 milestone replan; 7 rebaseline: `NEEDS_OWNER_DECISION` with options.
For tiers 3, 5 and 6:

1. Run the forecast impact command on the plan task: pause its forward subgraph with handoff; the rest continue.
2. Paused work commits to `wip/<task>-pre-replan` and runs its checks. Split into verified part (done, actual, reviews used) and delta inheriting only the remaining allowance; fresh allowance only from milestone reserve.
3. Never edit, re-estimate or restart done work unless a defect is shown in its output. Change how a criterion is met, never what it requires.
4. Rerun forecast; the forecast diff must report no violations; append its ledger under a new `plan_rev`.
5. Brief each affected delegate fresh; it echoes `plan_rev` and interfaces before work.

Notices: dedupe by root key, count corroboration, bind to `plan_rev`, expire on state change. A halt pauses only its subgraph. Execution evidence beats claims.

## Validate

The forecast tool exits 0; review its warnings. Diff clean on replan. Two failures with no new evidence: `BLOCKED`.

## Outcomes

`SUCCESS` (plan paths, evidence), `NEEDS_EVIDENCE`, `NEEDS_OWNER_DECISION`, `VALIDATION_FAILED`, `BLOCKED`. Return plan state (authored, reviewed, accepted, published), gaps, next action.

## Package contract (every field)

1. `id` + intended outcome: one sentence naming the observable capability when done.
2. `parents`: exact REQ/AC IDs satisfied or partly satisfied.
3. Prerequisites and inputs: done upstream IDs (`deps`), base commit or worktree, exact paths to read.
4. Role and authority: discipline/role, allowed tools, what it must not change (interfaces, AC targets).
5. Deliverables (`writes`): exact paths to create, modify or test. No placeholders.
6. Successors: downstream IDs that consume its outputs.
7. Interfaces: `consumes` / `produces` (signatures, schemas, socket or event names).
8. Verification: command, expected red before, expected green after, budgets (frame time, polycount).
9. Resources: `locks`, `slots` (0 for an owner gate), model tier, `reviews_max`, retry cap.
10. Uncertainty: O/M/P per bucket, `hill` (`uphill` discovery or `downhill` execution), assumptions with evidence.
11. Escalation: conditions that stop work and emit a notice (class named).

States: `todo`, `in_progress`, `paused`, `wip_reverted`, `done` (verified, with `actual` and `reviews_used`).

## Dependency domains

| Domain | Edge | Rule |
|---|---|---|
| Interface | hard | Lock schemas and signatures before consumers fan out. |
| Asset pipeline | hard | Concept, mesh/UV, materials and rig, animation, scene assembly, LOD/nav/profiling. Pre-flight each export. |
| Risk probe | soft, promoted to hard | Probe unknowns before bulk content depends on them. |
| Owner gate | hard | Subjective approval (style, feel, interface lock); `slots: 0`. |
| Resource | leveling | Serialize shared binaries, GPU, review queue within float. |

## Milestone ladder

| Artifact | Proves | Leaves unproven |
|---|---|---|
| Prototype | one core question (fun, feasibility) | production pipeline, look, scale, target performance |
| Vertical slice | one loop at final quality on target; second-asset timings | content throughput, long-session stability, full progression |
| Alpha | every system end to end, greybox content | full content, density |
| Beta | 100% content integrated | edge regressions, hardware matrix, packaging |
| Complete | packaged build passing all AC, budgets and soak | live use |
| Demo recording | presentation intent only | everything interactive; never verification evidence |

Each milestone names its integration owner (integration role plus owner sign-off) and ends with a verification gate task.

## Estimate buckets

`setup`, `agent`, `asset` (time the second asset of each class), `wait` (review queue, locks, runners), `human` (owner effort, only from supplied hours), `review_repair` (never zero), `integration` (one task closing each fan-out), `test` (per task plus a milestone gate), `external` (approvals, vendors: calendar lags). Compute/API spend goes in task `cost`.

Cold start (assumption until actuals exist): O = 0.7 M, P = 2-2.5 M, +20-35% review/repair. Sanity-check milestone totals against a reference class when one exists; use the throughput forecast once 8+ tasks are done.

Estimate agent work bottom-up from the task's steps. Each non-done task records `estimate_basis`: `steps` summing to M (remaining M when `remaining` applies) or `{"observed": ref}`. `lock_buckets` {lock: bucket} holds that lock only for that bucket's share at the task end; use it for the review queue. Float and critical-path reporting preserve that scoped resource ordering. The forecast tool warns on a missing/inconsistent basis, placeholder basis text and identical estimates sharing one basis text; these warnings fail the basis check.

Estimate is a distribution. Appetite is the owner's ceiling. Commitment is P80. Never state confidence the forecast did not compute.

## Notice

```yaml
id: NTF-<plan>-<n>
root_key: <dependency or interface id>   # dedupe key
plan_rev: <rev>
class: MISSING_INFO | UNVALIDATED_ASSUMPTION | PREDICTED_RISK | DEMONSTRATED_BLOCKER | PLAN_DEFECT | PRODUCT_DEFECT | RESOURCE_CONTENTION | SCOPE_CHANGE_REQUEST
origin: <role> (<task>)
at: <UTC timestamp>
evidence: <log, path:line, metric>; confidence: HIGH | MEDIUM | LOW
affected: {acs: [], upstream: [], downstream: []}
impact: {critical_path_slip, float_used, cost_delta}
urgency: IMMEDIATE_HALT | BEFORE_TASK_START | NEXT_WAVE_REVIEW
remedy: <recommended>; alternatives: []
decider: worker | planner | owner
continues: [tasks safe to keep running]
corroborating: <count>
status: OPEN | ACKNOWLEDGED | RESOLVED | EXPIRED_SUPERSEDED
resolution: <ledger ref>
```

Routing: worker retries tool errors twice and fixes product defects inside its red-green loop. Planner owns contention, plan defects and local splits. Owner owns a silent spec, scope change, subjective gates and an appetite breach. Unvalidated assumptions go to the assumption ledger with a probe task. Predicted-risk signals: budget margin erosion, buffer use above 50%.

## plan.json

Plan: `plan_rev`, `now`, `cap` (5), `rho` (0.6), `trials`, `seed`, `deadline`, `appetite`, `resources` {name: capacity, e.g. `review`: 2}, `acceptance` [], `coverage` {AC: {`deferred`, `trigger`} | {`evidence`} | {`gap`}}, `cold_start` {o, p, review}, `damping_n` (5), `reference_class` [hours], `throughput_period` (8), `milestones` [{`id`, `artifact` (ladder name, snake_case), `tasks`, `entry`, `exit_evidence`, `proves`, `unproven`, `integration_owner`}].

Task: `id`, `parents`, `deps`, `after` (soft), `o`/`m`/`p` or `m` or `buckets` {name: [o, m, p]}, `remaining` {o, m, p}, `status`, `actual`, `done_at`, `cost` {o, m, p}, `class`, `hill`, `reviews_max`, `reviews_used`, `split_from`, `reserve`, `consumes`, `produces`, `writes`, `locks`, `lock_buckets` {lock: bucket}, `estimate_basis`, `slots`.

Forecast errors exit 1 (schema, cycle, uncovered AC). Placeholders, unmatched interfaces and parallel write overlap are warnings.

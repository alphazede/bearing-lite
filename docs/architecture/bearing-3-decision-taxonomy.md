# Decision taxonomy and Coordinator duty inventory

Observer: Implementer, slice S02, 2026-11-17. Source revision: bearing-lite `9fdf4d0`. Counts of how often each decision fires are unmeasured. This slice has no journey baseline.

Maintenance owner: bearing-lite maintainers. Update this report when a listed evaluator, policy constant, or Coordinator duty owner changes.

## Measurement rules

Fixed before the tables were filled:

- Population: every outcome return in `hooks/transition-order.cjs` `evaluate`, every outcome-selecting key in `hooks/policy.cjs`, every function in `hooks/plan-package.cjs` that pushes a finding or returns `PASS`/`FAIL`, every disposition return in `hooks/owner-stops.cjs` `evaluateOwnerStop`, every outcome return in `hooks/planning-review.cjs`, every outcome return in `hooks/assurance-dispatch.cjs`, and the instructed non-assurance dispatch sentence. Helpers that do not choose an outcome (`repoRoot`, `readJson`, `walk`, `sliceIndex`, `semanticKey`, `collectWriteSet`, `stable`) are not decision points.
- Frequency: the trigger. The cell includes `count unmeasured` because no baseline count exists. The cell is not a rate.
- Cost: `executable-local, no model call` when the cited function does not call a model. `owner-wait` when the outcome asks the owner (`ASK`, `QUEUE`, `OWNER_DECISION_REQUIRED`, `OWNER_AMENDMENT_REQUIRED`).
- Uncertainty: `rule-closed` when the branch has a coded condition. `missing-input` when the branch returns because input is absent or unverifiable.
- Consequences: the outcome token, and whether work continues, stops, or waits.
- Enforcement: `file:line` of the branch. `none` only when no executable branch exists. A function that exists but is not a registered hook is still cited, and the cell says it is not registered.

`hooks/hooks.json:2` states that transition-order and protected-action remain procedural. Bound assurance dispatch is checked on every pretool event.

## Enforced versus instructed

Seed for the baseline report. This slice does not write `docs/architecture/bearing-3-baseline.md`. One class per row.

| Behavior | Class | Citation |
| --- | --- | --- |
| Bound assurance launch | enforced | `hooks/assurance-dispatch.cjs:185-203`, registered at `hooks/hooks.json:16-24`. Test: `test/hook-contract.test.mjs` loads the dispatch hook. |
| Dispatch of every other role | instructed | `skills/bearing-lite/SKILL.md:48-55`. No hook selects the role. |
| Transition order | instructed to run; the evaluator is not registered | `hooks/transition-order.cjs:120-300`. `hooks/hooks.json:2` says it remains procedural. `skills/bearing-lite/references/owner-stops.md:126` tells the agent to run it. Stale generation on event reduction is a separate executable branch at `hooks/reconcile.cjs:64`. |
| Planning-artifact write lock | enforced | `hooks/orchestrator-write-lock.cjs:773`, registered at `hooks/hooks.json:38-47`. Owner map includes both roles at `hooks/orchestrator-write-lock.cjs:131-132`. |
| Test-engineering write check | enforced | `hooks/te-host.cjs:7` and `hooks/te-host.cjs:32`, registered at `hooks/hooks.json:28-36`. |
| Product write-set check | executable function, not registered | `hooks/write-set-check.cjs:80-89`. `test/hook-contract.test.mjs:71` records it as a CLI evaluator with no hook class. |
| Exact write set on an assignment | instructed | `skills/implementer/SKILL.md:18-25`. |
| Lease revalidation | instructed | `skills/bearing-lite/references/task-state.md:80-96`; `skills/implementer/SKILL.md:29-39`. |
| Stale generation on event reduction | enforced inside `applyEvent` | `hooks/reconcile.cjs:64`. Not a host-registered lifecycle hook. |
| Assurance budget at launch | enforced for bound assurance | `hooks/assurance-budget.cjs:134`, called from `hooks/assurance-dispatch.cjs:111-117`. |
| Planning review and correction | executable function, not a host hook | `hooks/planning-review.cjs:90-184`. `hooks/plan-package.cjs:590` calls it when a wave receipt is present. |
| Owner-stop class | executable function, called from transition-order | `hooks/owner-stops.cjs:21-52`, called at `hooks/transition-order.cjs:144-152`. The transition-order hook is not registered. |
| Protected action | executable function, not registered | `hooks/protected-action.cjs:84-179`. `hooks/hooks.json:2` says it remains procedural. Instruction: `skills/bearing-lite/references/owner-stops.md:61-90`. |

## Transition order

Site: `hooks/transition-order.cjs` `evaluate` (lines 120-300). Trigger: each call. Cost: executable-local, no model call, except the owner-stop row that can ask the owner. Not a registered hook (`hooks/hooks.json:2`).

| Id | Decision | Frequency | Uncertainty | Consequences | Enforcement |
| --- | --- | --- | --- | --- | --- |
| TO-01 | Missing input | per call, count unmeasured | missing-input | `UNAVAILABLE`. Work is not allowed by this call. | `hooks/transition-order.cjs:123` |
| TO-02 | Input string is not JSON | per call, count unmeasured | missing-input | `UNAVAILABLE` `malformed_input`. | `hooks/transition-order.cjs:129` |
| TO-03 | Input is not an object | per call, count unmeasured | missing-input | `UNAVAILABLE` `malformed_input`. | `hooks/transition-order.cjs:133` |
| TO-04 | Infrastructure failure flag | per call, count unmeasured | missing-input | `UNAVAILABLE`. | `hooks/transition-order.cjs:137` |
| TO-05 | Safe channel | per call, count unmeasured | rule-closed | `ADVISE` `channel_open`. Work may continue. | `hooks/transition-order.cjs:141` |
| TO-06 | Owner-stop check | per call, count unmeasured | rule-closed | Maps the owner-stop disposition. `ASK` becomes `REROUTE` (owner-wait). `NEEDS_MORE_EVIDENCE` becomes `UNAVAILABLE`. Otherwise `ADVISE`. | `hooks/transition-order.cjs:144-152` |
| TO-07 | Planning review passed | per call, count unmeasured | rule-closed | `ADVISE`. | `hooks/transition-order.cjs:158` |
| TO-08 | Planning review did not pass | per call, count unmeasured | rule-closed | `REROUTE` or `BLOCK`. Dispatch stays closed. | `hooks/transition-order.cjs:160-164` |
| TO-09 | Assurance budget passed | per call, count unmeasured | rule-closed | `ADVISE`. | `hooks/transition-order.cjs:170` |
| TO-10 | Assurance budget did not pass | per call, count unmeasured | rule-closed | `REROUTE` or `BLOCK`. | `hooks/transition-order.cjs:172-176` |
| TO-11 | Missing from-state or to-state | per call, count unmeasured | missing-input | `UNAVAILABLE` `malformed_input`. | `hooks/transition-order.cjs:182` |
| TO-12 | Unknown from-state | per call, count unmeasured | missing-input | `UNAVAILABLE` `unknown_from_state`. | `hooks/transition-order.cjs:185` |
| TO-13 | Explicit skip after a reroute | per call, count unmeasured | rule-closed | `BLOCK`. The transition stops. | `hooks/transition-order.cjs:201-206` |
| TO-14 | Explicit skip that invalidates dependents | per call, count unmeasured | rule-closed | `BLOCK`. | `hooks/transition-order.cjs:210-215` |
| TO-15 | Target is not a legal edge | per call, count unmeasured | rule-closed | `REROUTE`. The jump is not taken. | `hooks/transition-order.cjs:219-223` |
| TO-16 | Prerequisites not met | per call, count unmeasured | rule-closed | `REROUTE`. | `hooks/transition-order.cjs:231-235` |
| TO-17 | `EVIDENCE_READY` to `REVIEWING` fails the budget | per call, count unmeasured | rule-closed | `REROUTE`. | `hooks/transition-order.cjs:242-246` |
| TO-18 | `COMPLETE` while assurance is missing, and the skip is explicit | per call, count unmeasured | rule-closed | `BLOCK`. | `hooks/transition-order.cjs:253-258` |
| TO-19 | `COMPLETE` while assurance is missing, skip not explicit | per call, count unmeasured | rule-closed | `REROUTE` to the missing role. | `hooks/transition-order.cjs:260-264` |
| TO-20 | Assurance order is not the next role | per call, count unmeasured | rule-closed | `REROUTE`. | `hooks/transition-order.cjs:276-280` |
| TO-21 | First explicit skip | per call, count unmeasured | rule-closed | `REROUTE`. Hard block waits for a repeat. | `hooks/transition-order.cjs:290-294` |
| TO-22 | Legal edge, checks passed | per call, count unmeasured | rule-closed | `ADVISE`. The edge stays legal. | `hooks/transition-order.cjs:297` |
| TO-23 | Evaluator threw | per call, count unmeasured | missing-input | `UNAVAILABLE` `adapter_exception`. | `hooks/transition-order.cjs:299` |

Cost for TO-01 through TO-23 is executable-local, no model call. TO-06 adds owner-wait when the mapped disposition is `ASK`.

## Policy

Site: `hooks/policy.cjs`. These keys select an outcome. Descriptive lists that do not by themselves choose allow or deny (`candidate_fields`, `planning_sessions_optional`, `numeric_score_gates`, `cadence_values`, `default_cadence`, `mixed_cadence_reviewer_consumption`) are inputs to the rows below, not separate decision points. Trigger: each evaluator read. Cost: executable-local, no model call. Frequency: per evaluator call, count unmeasured.

| Id | Decision | Uncertainty | Consequences | Enforcement |
| --- | --- | --- | --- | --- |
| POL-01 | One reviewer slot. Exhaustion outcome is `FAIL_ROUND`. | rule-closed | The round fails when the slot is exhausted. | `hooks/policy.cjs:11-12`, `hooks/policy.cjs:21`; applied at `hooks/planning-review.cjs:132` |
| POL-02 | One planning review round | rule-closed | A further round halts. | `hooks/policy.cjs:17`; applied at `hooks/planning-review.cjs:135` |
| POL-03 | At most one aggregated planning repair | rule-closed | A second repair halts. | `hooks/policy.cjs:18`; applied at `hooks/planning-review.cjs:177` |
| POL-04 | Automatic rereview prohibited | rule-closed | `OWNER_AMENDMENT_REQUIRED`. | `hooks/policy.cjs:20`; applied at `hooks/planning-review.cjs:147` |
| POL-05 | Terminal planning outcomes are `HALT` and `OWNER_AMENDMENT_REQUIRED` | rule-closed | Those two outcomes end the round. | `hooks/policy.cjs:22` |
| POL-06 | Planning review only when the owner requested it | rule-closed | An unrequested review is not dispatched. | `hooks/policy.cjs:27`; applied at `hooks/plan-package.cjs:544-550` |
| POL-07 | At most one `requires_regate` round | rule-closed | A further correction round is not automatic. | `hooks/policy.cjs:28` |
| POL-08 | Assurance gate order is the frozen list | rule-closed | Gates run in that order. | `hooks/policy.cjs:32-40`; consumer `hooks/assurance-budget.cjs:134` |
| POL-09 | One assurance review round and one aggregated repair | rule-closed | A further round or repair halts dispatch. | `hooks/policy.cjs:51-52`; applied at `hooks/assurance-dispatch.cjs:109` and `hooks/assurance-dispatch.cjs:121` |
| POL-10 | Phase or wave end review is required. Per-slice review is cadence-gated. | rule-closed | A slice review does not run unless the cadence says so. | `hooks/policy.cjs:54-55` |
| POL-11 | Post-repair rereview and same-unit automatic rereview are prohibited | rule-closed | No second review of the same unit. | `hooks/policy.cjs:56-57` |
| POL-12 | Budget does not reset on candidate, model, harness, role, session, resume, or rename | rule-closed | Spent budget stays on the declared unit. | `hooks/policy.cjs:58-64` |
| POL-13 | Budget resets only on the next distinct declared phase or wave | rule-closed | A new unit is the only reset. | `hooks/policy.cjs:65-66` |

## Plan package

Site: `hooks/plan-package.cjs`. One row per function that emits findings or returns `PASS`/`FAIL`. Trigger: each package or wave read, count unmeasured. Cost: executable-local, no model call. Uncertainty: `rule-closed`. Consequences: `FAIL` when that function records a finding, otherwise the finding list is empty and `freeze` or `waveView` can return `PASS`.

| Id | Decision | Enforcement |
| --- | --- | --- |
| PKG-01 | Role and command checks | `hooks/plan-package.cjs:47-69` |
| PKG-02 | Work-class command and role checks | `hooks/plan-package.cjs:73-82` |
| PKG-03 | Planning-role placement | `hooks/plan-package.cjs:86-99` |
| PKG-04 | Digest and planning-input checks | `hooks/plan-package.cjs:116-167` |
| PKG-05 | Duplicate gate check | `hooks/plan-package.cjs:189-213` |
| PKG-06 | Integration step references | `hooks/plan-package.cjs:267-285` |
| PKG-07 | Frozen hashes | `hooks/plan-package.cjs:289-332` |
| PKG-08 | Live pins | `hooks/plan-package.cjs:359-404` |
| PKG-09 | Manifest projection | `hooks/plan-package.cjs:408-497` |
| PKG-10 | Planning wave record, including unrequested review | `hooks/plan-package.cjs:514-623` |
| PKG-11 | Planning correction lineage | `hooks/plan-package.cjs:626-666` |
| PKG-12 | Boundary contract | `hooks/plan-package.cjs:678-744` |
| PKG-13 | Final register precheck | `hooks/plan-package.cjs:748-760` |
| PKG-14 | Freeze aggregates findings into `PASS` or `FAIL` | `hooks/plan-package.cjs:763-788` |
| PKG-15 | Wave read: missing wave or unresolved slice is `FAIL` | `hooks/plan-package.cjs:801-839` |

`PKG-15` is the executable wave reader used by the Coordinator at `skills/coordinator/SKILL.md:49`. The command entry is `hooks/plan-package.cjs:864-870`.

## Owner stops

Site: `hooks/owner-stops.cjs` `evaluateOwnerStop`. Trigger: each owner-stop check, count unmeasured. Cost is owner-wait for `ASK` and `QUEUE`, and executable-local for the other rows. No model call.

| Id | Decision | Uncertainty | Consequences | Enforcement |
| --- | --- | --- | --- | --- |
| OS-01 | Class, blocking flag, or evidence reference missing | missing-input | `NEEDS_MORE_EVIDENCE`. No continuation. | `hooks/owner-stops.cjs:24` |
| OS-02 | Class C, E, or F | rule-closed | `ASK` if blocking (owner-wait). `QUEUE` if not (owner-wait). | `hooks/owner-stops.cjs:27` |
| OS-03 | Continuation grant incomplete | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/owner-stops.cjs:37` |
| OS-04 | Grant expired | rule-closed | `NEEDS_MORE_EVIDENCE`. | `hooks/owner-stops.cjs:41` |
| OS-05 | Expiry not verifiable | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/owner-stops.cjs:43` |
| OS-06 | Required checks or resolution reference missing | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/owner-stops.cjs:49` |
| OS-07 | Grant and checks present | rule-closed | `CONTINUE`. Work may proceed under that authority id. | `hooks/owner-stops.cjs:51` |

`ownerWaitMetrics` (`hooks/owner-stops.cjs:64-67`) reports `unavailable` when tracking is off. It does not allow or deny work, so it is not a decision point.

## Review

Site: `hooks/planning-review.cjs`. Trigger: each review evaluation, count unmeasured. Cost: executable-local, no model call, except rows whose outcome waits on the owner.

| Id | Decision | Uncertainty | Consequences | Enforcement |
| --- | --- | --- | --- | --- |
| RV-01 | Wave object missing | missing-input | `NEEDS_MORE_EVIDENCE` `planning_sessions_incomplete`. | `hooks/planning-review.cjs:49` |
| RV-02 | Declared sessions are not the known set | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:59` |
| RV-03 | Session names duplicate or fall outside the declaration | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:64` |
| RV-04 | A declared session has not returned | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:87` |
| RV-05 | Review record missing | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:92` |
| RV-06 | Manifest file not generated | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:97` |
| RV-07 | Correction id invalid | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:100` |
| RV-08 | Requirement register missing | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:108` |
| RV-09 | Slot binding invalid | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:129` |
| RV-10 | Reviewer slot exhausted | rule-closed | `FAIL_ROUND` from `POL-01`. The round stops. | `hooks/planning-review.cjs:132` |
| RV-11 | Review round over the limit | rule-closed | `HALT`. | `hooks/planning-review.cjs:135` |
| RV-12 | Review round still pending | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:138` |
| RV-13 | Review round record invalid | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:141` |
| RV-14 | Automatic rereview | rule-closed | `OWNER_AMENDMENT_REQUIRED` (owner-wait). | `hooks/planning-review.cjs:147` |
| RV-15 | Candidate or independence mismatch | rule-closed | `HALT`. | `hooks/planning-review.cjs:170` |
| RV-16 | Aggregation still pending | missing-input | `NEEDS_MORE_EVIDENCE`. | `hooks/planning-review.cjs:173` |
| RV-17 | Aggregated repair over the limit | rule-closed | `HALT`. | `hooks/planning-review.cjs:177` |
| RV-18 | Post-repair deterministic gate not passed | rule-closed | `HALT`. | `hooks/planning-review.cjs:180` |
| RV-19 | Aggregation complete and the gate passed | rule-closed | `PASS`. | `hooks/planning-review.cjs:182` |

## Dispatch

| Id | Decision | Frequency | Cost | Uncertainty | Consequences | Enforcement |
| --- | --- | --- | --- | --- | --- | --- |
| DP-00 | Launch a role other than bound assurance | per assignment, count unmeasured | executable-local, no model call | rule-closed as text only | The Orchestrator launches once and waits. No hook enforces this choice. | none. Instruction: `skills/bearing-lite/SKILL.md:48-55` |
| DP-01 | Task record shape invalid | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `invalid_task_record`. | `hooks/assurance-dispatch.cjs:50` |
| DP-02 | Journey id mismatch | per pretool, count unmeasured | executable-local, no model call | rule-closed | `gap` `declaration_journey_mismatch`. | `hooks/assurance-dispatch.cjs:52` |
| DP-03 | Declaration digest mismatch | per pretool, count unmeasured | executable-local, no model call | rule-closed | `gap` `dispatch_declaration_mismatch`. | `hooks/assurance-dispatch.cjs:53` |
| DP-04 | Baseline missing or invalid | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `dispatch_baseline_missing` or `dispatch_baseline_invalid`. | `hooks/assurance-dispatch.cjs:54`, `hooks/assurance-dispatch.cjs:74` |
| DP-05 | Assurance unit record invalid | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `invalid_assurance_units` or `assurance_unit_record_missing`. | `hooks/assurance-dispatch.cjs:59`, `hooks/assurance-dispatch.cjs:96` |
| DP-06 | Dispatch log or amendment bounds invalid | per pretool, count unmeasured | executable-local, no model call | rule-closed | `gap` `invalid_dispatch_log` or `invalid_assurance_amendment`. | `hooks/assurance-dispatch.cjs:67`, `hooks/assurance-dispatch.cjs:80`, `hooks/assurance-dispatch.cjs:101` |
| DP-07 | Counter would reset | per pretool, count unmeasured | executable-local, no model call | rule-closed | `gap` `assurance_counter_reset`. | `hooks/assurance-dispatch.cjs:75` |
| DP-08 | Slot already reserved | per pretool, count unmeasured | executable-local, no model call | rule-closed | `HALT`. The launch does not repeat. | `hooks/assurance-dispatch.cjs:99` |
| DP-09 | Amendment scope does not match the slot | per pretool, count unmeasured | owner-wait | rule-closed | `OWNER_DECISION_REQUIRED`. | `hooks/assurance-dispatch.cjs:103`, `hooks/assurance-dispatch.cjs:107` |
| DP-10 | Round already closed, or round or repair over the limit | per pretool, count unmeasured | executable-local, no model call | rule-closed | `HALT`. | `hooks/assurance-dispatch.cjs:108-109`, `hooks/assurance-dispatch.cjs:118-121`, `hooks/assurance-dispatch.cjs:127` |
| DP-11 | Assurance budget evaluator did not pass | per pretool, count unmeasured | executable-local, no model call | rule-closed | That evaluator's outcome is returned. | `hooks/assurance-dispatch.cjs:117` |
| DP-12 | Aggregate review needs the owner, or is incomplete, or repair is incomplete | per pretool, count unmeasured | owner-wait when the outcome asks the owner; otherwise executable-local | rule-closed | `OWNER_DECISION_REQUIRED` or `gap`. | `hooks/assurance-dispatch.cjs:130`, `hooks/assurance-dispatch.cjs:133`, `hooks/assurance-dispatch.cjs:138`, `hooks/assurance-dispatch.cjs:140` |
| DP-13 | Qualification authority missing, changed, or unreadable | per pretool, count unmeasured | owner-wait for the missing-authority outcome; otherwise executable-local | missing-input | `OWNER_DECISION_REQUIRED` or `gap`. | `hooks/assurance-dispatch.cjs:144-146` |
| DP-14 | Bound slot accepted | per pretool, count unmeasured | executable-local, no model call | rule-closed | `PASS` `dispatch_reserved`. | `hooks/assurance-dispatch.cjs:154-156` |
| DP-15 | No binding on the event | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `dispatch_binding_missing`. | `hooks/assurance-dispatch.cjs:162` |
| DP-16 | Bounded amendment required or recorded | per amendment, count unmeasured | owner-wait until the authority check passes | rule-closed | `OWNER_DECISION_REQUIRED` or `PASS` `bounded_amendment_recorded`. | `hooks/assurance-dispatch.cjs:166-171`, `hooks/assurance-dispatch.cjs:181` |
| DP-17 | Amendment state unavailable | per amendment, count unmeasured | executable-local, no model call | missing-input | `gap` `amendment_state_unavailable`. | `hooks/assurance-dispatch.cjs:183` |
| DP-18 | Host input invalid or unreadable | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `host_input_invalid` or `host_input_unavailable`. | `hooks/assurance-dispatch.cjs:188`, `hooks/assurance-dispatch.cjs:221` |
| DP-19 | Event is not PreToolUse or beforeShellExecution | per pretool, count unmeasured | executable-local, no model call | rule-closed | `INACTIVE`. Ordinary work continues. | `hooks/assurance-dispatch.cjs:190` |
| DP-20 | Safe tool, unbound work, or Cursor shell deferred | per pretool, count unmeasured | executable-local, no model call | rule-closed | `INACTIVE`. | `hooks/assurance-dispatch.cjs:193`, `hooks/assurance-dispatch.cjs:195`, `hooks/assurance-dispatch.cjs:197` |
| DP-21 | Host cannot enforce | per pretool, count unmeasured | executable-local, no model call | rule-closed | `gap` `host_enforcement_unavailable`. | `hooks/assurance-dispatch.cjs:196`. Host table: `hooks/assurance-dispatch.cjs:10-18` |
| DP-22 | Bound work with no declared slot | per pretool, count unmeasured | owner-wait | rule-closed | `OWNER_DECISION_REQUIRED` `undeclared_bound_launch`. | `hooks/assurance-dispatch.cjs:200` |
| DP-23 | Dispatch state threw | per pretool, count unmeasured | executable-local, no model call | missing-input | `gap` `dispatch_state_unavailable`. | `hooks/assurance-dispatch.cjs:202` |

## Coordinator duty inventory

One receiving component per duty. The source column records the former Coordinator procedure. The Implementation Orchestrator owns those duties for new waves. Frozen legacy assignments require their pinned runtime or an explicit handover. D10 is profile compatibility, not one of the migrated duties, and is listed so it is not mistaken for a second owner of D1 to D9 or D11.

| Duty | Receiver | Current owner | Enforcement today |
| --- | --- | --- | --- |
| D1 Wave scheduling | Implementation Orchestrator, by a ready-set read of the frozen graph. The pool tool does not order dependencies. | `skills/coordinator/SKILL.md:32-35` | instructed. Wave and slice data: `schemas/implementation.schema.json:718-745`. |
| D2 Wave receipts | Implementation Orchestrator, using the existing wave reader | `skills/coordinator/SKILL.md:49` and `skills/coordinator/references/wave-operations.md:3-8` | executable read: `hooks/plan-package.cjs:801-839` and `hooks/plan-package.cjs:864-870` |
| D3 Dependency checks | Implementation Orchestrator, same ready-set read as D1 | `skills/coordinator/SKILL.md:32-35` | partly executable: `hooks/reconcile.cjs:92` |
| D4 Lease checks | Implementation Orchestrator | `skills/coordinator/SKILL.md:21-27` and `skills/implementer/SKILL.md:29-39` | instructed at `skills/bearing-lite/references/task-state.md:80-96`. Stale generation is executable at `hooks/reconcile.cjs:64`. |
| D5 Write-set checks | Implementation Orchestrator, invoking the existing check. No new guard. | `skills/coordinator/SKILL.md:37-39` | post-hoc function `hooks/write-set-check.cjs:80-89`, not registered. Test-file writes: `hooks/te-host.cjs:7`. |
| D6 Event-driven dispatch | Implementation Orchestrator | `skills/coordinator/SKILL.md:47-56` and `skills/bearing-lite/SKILL.md:48-55` | instructed, except bound assurance at `hooks/assurance-dispatch.cjs:185-203` |
| D7 Evidence integration | Implementation Orchestrator | `skills/coordinator/SKILL.md:37-39` and `skills/coordinator/SKILL.md:56` | Manifest render is executable (`tools/render-dod-manifest.mjs:1`). Write permission lists both roles at `hooks/orchestrator-write-lock.cjs:131-132`. Landing text: `skills/bearing-lite/references/task-state.md:46-78`. |
| D8 Review and assurance dispatch | Implementation Orchestrator | `skills/coordinator/SKILL.md:40-44` and `skills/bearing-lite/SKILL.md:31-34` | executable for bound assurance: `hooks/assurance-dispatch.cjs:91-157` and `hooks/assurance-budget.cjs:134` |
| D9 Escalation | Implementation Orchestrator, using the owner-stop classes. The owner remains the recipient of classes A to F. | `skills/coordinator/SKILL.md:46` | rule text `skills/bearing-lite/references/owner-stops.md:32-43`. Classification: `hooks/owner-stops.cjs:21-52`. |
| D11 Storage cleanup | Implementation Orchestrator, using the existing pool tool | `skills/coordinator/SKILL.md:36` | executable tool `tools/lifecycle-pool.mjs:1-47`. The reference already says the Orchestrator calls it: `skills/bearing-lite/references/storage-lifecycle.md:16-23` and `skills/bearing-lite/references/storage-lifecycle.md:60-62`. |

D10, not a migrated duty: `roles.coordinator` resolution stays in the profile layer (`schemas/profiles.schema.json:298`, `hooks/profiles.cjs:238-267`). It has one compatibility receiver, the profile freeze, and it is not a second receiver for D1 to D9 or D11.

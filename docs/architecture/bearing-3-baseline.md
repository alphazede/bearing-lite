# Bearing 3.0 baseline

Wave 1 measurement at `2026-11-17T21:30:00Z`. The profiler candidate is bearing-lite `7c6156d`. This file is the public summary. Raw profiler output and per-journey rows stay in the private baseline evidence.

## Class definitions

The status enum is `planning`, `implementation`, `complete`, and `cancelled`. It has no failed or interrupted value.

A journey is completed when `journey.status` is exactly `complete`. A journey is failed when it is not completed and a record verdict is exactly `FAIL`. Every other included journey is interrupted. Interrupted is the residual class. It is not read from a status token outside the enum.

Stage comes from the latest mapped `stage` field. The map is planning, implementation, review, and assurance, using the exact stage strings in the private class rules. When no mapped stage exists, planning and `waiting_on` count as planning, and `implementation`, `implementing`, `complete`, `COMPLETE`, and `closeout` count as implementation. Any other unevidenced status counts as planning. That fallback is a coverage note, not an observed stage.

## Population

Included journeys: 38. Class totals: completed 10, failed 1, interrupted 27. The class totals equal the included population. Excluded files stay in the input manifest with a reason.

| Class | Planning | Implementation | Review | Assurance |
| --- | --- | --- | --- | --- |
| completed | 4 | 5 | 1 | 0 |
| failed | 0 | 0 | 1 | 0 |
| interrupted | 16 | 8 | 3 | 0 |

A zero cell has no assigned journey. The cell is shown. It is not omitted.

Journeys whose stage used the status fallback: 16. Journeys whose status is outside the enum: 5.

## Coverage gaps

No included journey sets `profiler_tracking`. The shipped profiler writes no profile and reads no host log in that case. Both profiler runs exited 0 and wrote no bytes. The sha256 of that empty output is `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` for each run.

No SEIT-HOSTNORM receipt is passed for this census. Every host metric is unavailable. Codex stays unavailable under finding F8. Unestablished hosts stay unavailable under finding F9. Claude Code has no recorded controlled-run qualification here, so its metrics are unavailable too.

Journeys with no `events.jsonl` beside the journey file: 38. Elapsed time, owner wait, and the two cohort ratios are unavailable. Agent idle is unavailable because dispatch times are not recorded. Bound, inferred, and unattributed usage rows were not emitted.

Role, model, and harness token rows are unavailable. This summary does not name a model or a harness.

## Consumption attribution

The seven categories are useful work, repeated instructions or context, redundant validation, planning artifact rework, duplicate evidence, review and assurance overlap, and unnecessary model decisions. Each is unavailable (`no_attributed_fresh_tokens`). The unclassified remainder is unavailable for the same reason. There is no numeric total, so the split was not filled with zero.

## Trace audit

Journeys with a trace: 38. Journeys with no trace: 0. No-trace journeys are counted. They are not dropped.

- redundant prompt passes: 1
- repeated mistakes: 2
- verification gaps: 3
- correction loops: 1

## Mechanical correction cost

Correction-delta records in the census: 5. Records under this wave 1 plan: 0. Wave 1 has not closed. Specialist handoff count is unavailable because those receipts do not list handoffs. `fresh_tokens` is unavailable because no session was attributed. The write lock was not edited. No exemption was applied.

## Ranked opportunities

Rank is the observed count, largest first. Equal counts use the opportunity id in alphabetical order. Each row cites that count.

1. Journeys with profiler_tracking not set. Observed count: 38. Regression criterion: A journey that sets the flag still emits no secrets and no raw prompts. Rollback criterion: Clear the flag. The profiler then writes nothing for that journey.
2. Journeys with no qualified host metric. Observed count: 38. Regression criterion: A metric for a host without a passing SEIT-HOSTNORM receipt stays unavailable. Rollback criterion: Remove that host log from the manifest. Do not replace the gap with a number.
3. Journeys with no events.jsonl beside the journey file. Observed count: 38. Regression criterion: Elapsed time stays last event time minus first event time from the event file the profiler reads. Rollback criterion: Stop passing the event file. Do not invent an elapsed time from another clock.
4. Correction-delta records whose fresh_tokens are unavailable. Observed count: 5. Regression criterion: hooks/orchestrator-write-lock.cjs stays byte-identical to 9fdf4d0 while the cost is unknown. Rollback criterion: Do not apply a write-lock exemption. B30-120 stays inactive.

## Enforced versus instructed

One class per row. The row list is the S02 taxonomy table at `docs/architecture/bearing-3-decision-taxonomy.md:20-38` on bearing-lite `b43ae58`, plus the prompt expected-files sentence from placement section 2.6. A row is enforced only when a registered hook or an executable check refuses the violation and a test proves that refusal. Every other row is instructed.

| Behavior | Class | Citation |
| --- | --- | --- |
| Bound assurance launch | enforced | hooks/assurance-dispatch.cjs:185-203, registered at hooks/hooks.json:16-24. Test: test/hook-contract.test.mjs:544. |
| Dispatch of every other role | instructed | skills/bearing-lite/SKILL.md:48-55. No hook selects the role. |
| Transition order | enforced | hooks/transition-order.cjs:218-223 reroutes an illegal jump. Test: test/task-state.test.mjs:235. hooks/hooks.json:2 says the hook is not registered. |
| Planning-artifact write lock | enforced | hooks/orchestrator-write-lock.cjs:773, registered at hooks/hooks.json:38-47. Owner map at hooks/orchestrator-write-lock.cjs:131-132. Test: test/orchestrator-write-lock.test.mjs:26. |
| Test-engineering write check | enforced | hooks/te-host.cjs:32, registered at hooks/hooks.json:28-36. Test: test/hook-contract.test.mjs:76. |
| Product write-set check | enforced | hooks/write-set-check.cjs:80-89. Test: test/write-set-check.test.mjs:57. Not a registered hook (test/hook-contract.test.mjs:71). |
| Exact write set on an assignment | instructed | skills/implementer/SKILL.md:18-25. |
| Lease revalidation | instructed | skills/bearing-lite/references/task-state.md:80-96 and skills/implementer/SKILL.md:29-39. |
| Stale generation on event reduction | enforced | hooks/reconcile.cjs:64. Test: test/reconcile.test.mjs:61. Not a host-registered lifecycle hook. |
| Assurance budget at launch | enforced | hooks/assurance-budget.cjs:134, called from hooks/assurance-dispatch.cjs:111-117. Test: test/assurance-budget.test.mjs:113. |
| Planning review and correction | enforced | hooks/planning-review.cjs:90-184, called from hooks/plan-package.cjs:590. Test: test/planning-review.test.mjs:54. |
| Owner-stop class | enforced | hooks/owner-stops.cjs:21-52, called from hooks/transition-order.cjs:144-152. Test: test/owner-stops.test.mjs:59. |
| Protected action | instructed | hooks/hooks.json:2 says it remains procedural. Instruction: skills/bearing-lite/references/owner-stops.md:61-90. The function at hooks/protected-action.cjs:84-179 is not a registered hook. |
| Prompt expected-files guidance | instructed | skills/prompt/SKILL.md:36. Expected files are a guide, not a fence. |

## Reproducibility

Input manifest sha256: `80b2cb9b06ca45f17cdd6c836a6ea5b89539714409bf42dab864f205d6b91903`. Class rules sha256: `ef03ff45fe6e13197d7de73a1e8ff47a77fd47812c4a3db230192111a157f4ec`. Attribution rules sha256: `bb20ba0bd22b768834d42270cf993646667e41a222bc9e909efd61c99d2ee89b`. Trace coding sha256: `2d9c740bd42d3137d3810ee56fc976d70eb3cb6ac418e7aaa2b14a9460d89189`. The rules hashes were taken before the classification output was written. The same command on the same files writes these tables again.

The profiler command is `node tools/journey-profiler.mjs profile --as-of 2026-11-17T21:30:00Z --out <private-dir> --journey <each manifest journey.json>`. The planning template `--inputs` flag is not part of the shipped tool (`unknown_command` at `tools/journey-profiler.mjs:591`).

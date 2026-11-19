# Coordinator duty migration

The Implementation Orchestrator alone dispatches, schedules and escalates for new waves. A frozen assignment that delegates to an enabled legacy Coordinator retains that owner on its pinned runtime until an explicit handover. Keep one owner per duty. Never run both owners.

Execute the frozen plan. Do not redo planning. Land each wave as soon as its integrated gates pass. Gap work is its own pull request. Dispatch by dependency across waves, up to the agent cap the owner set for the Lifecycle. Do not start a planning role during implementation. An Implementer fixes a plan gap inside its write set and records one amendment line. Run gates once per integrated candidate. Apply rolling batch review when the approved Lifecycle selects it.

The Coordinator is retired on this runtime. Before removal, verify every duty and profile proof. Use the readiness result from `hooks/profiles.cjs` to identify active legacy journeys that require their pinned runtime or an explicit handover. Never silently rewrite a frozen legacy route.

| Duty | Receiving owner | Component |
| --- | --- | --- |
| D1 | Implementation Orchestrator | Graph-wide scheduling through `plan-package.cjs ready` and `hooks/ready-set.cjs` |
| D2 | Implementation Orchestrator | Wave receipts and one task graph through `hooks/plan-package.cjs` |
| D3 | Implementation Orchestrator | Dependency checks through `hooks/ready-set.cjs` |
| D4 | Implementation Orchestrator | Lease checks through `hooks/reconcile.cjs` |
| D5 | Implementation Orchestrator | Compare all changed paths against the exact recorded write set. Run `hooks/write-set-check.cjs` for path and whitespace hygiene. |
| D6 | Implementation Orchestrator | Event-driven dispatch through `hooks/dispatch-record.cjs` |
| D7 | Implementation Orchestrator | Evidence integration through `tools/render-dod-manifest.mjs` and `hooks/orchestrator-write-lock.cjs` |
| D8 | Implementation Orchestrator | Review dispatch at the wave boundary through `hooks/assurance-budget.cjs` |
| D9 | Implementation Orchestrator | Escalation through `hooks/owner-stops.cjs` |
| D10 | Profile layer | Profile compatibility, not a duty, through `hooks/profiles.cjs` |
| D11 | Implementation Orchestrator | Storage cleanup through `tools/lifecycle-pool.mjs` |

## Wave duties of the Implementation Orchestrator

Deliver the assigned wave directly. Prioritize unblocking work, parallel ready
assignments, and compact evidence without adding agents. Use the approved wave,
dependencies, exact write sets, acceptance, commands, authority, frozen
role/capability selections, visible receipt, and candidate. Planning belongs to
the Planning Orchestrator, not this implementation-wave work.

1. Continue the same assignment only while identity, authority, route, and
   generation remain valid. Revalidate the visible checkout lease against the
   approved Lifecycle, repository, checkout/worktree, branch, candidate revision,
   generation, and active state at wave start, after drift, and before commit.
   Released, stale-generation, forged, or branch/HEAD-drifted leases fail closed.
   Authorized same-Lifecycle child revisions refresh candidate_revision without
   another generation or duplicate dispatch. Use frozen selections, not live defaults.
2. Resume from the wave receipt; do not reread accepted artifacts or redispatch
   completed work. Each selected agent assignment launches once; additional
   invocations, retries, or repairs require explicit authority. Keep the wave
   graph, method-skill routing, and storage handoff per `wave-operations.md`.
3. Prioritize prerequisites and critical-path work. Launch every ready independent
   packet within selected capacity; avoid overloaded slices/waves and tiny handoffs.
   Serialize only real dependencies, overlapping writes, or shared mutable resources;
   name the reason and resource. Never add an unselected role.
   Start the Orchestrator in a directory that survives cleanup (outside leased
   task worktrees) and name the worktree explicitly for short commands so
   cleanup can reclaim released worktrees. Own storage cleanup via `node <plugin root>/tools/lifecycle-pool.mjs` (installed plugin path) per `storage-lifecycle.md`.
4. Inspect compact returns against acceptance and write sets. Integrate evidence
   without implementing; update implementation.json and the DoD Manifest once per
   wave, plus material owner-decision or blocker changes. Preserve unrelated work.
5. For a multi-slice phase or wave, independent assurance may start on finished
   slices' immutable receipts and the pinned candidate while the last slice
   runs. The same session joins the last slice's receipts before issuing its
   verdict on the final integrated candidate and keeps single-run role and gate
   budgets. Run deterministic checks. For sessions that have yet to start,
   use the existing dispatch rule. When they pass, immediately dispatch the profile-enabled review or assurance
   the owner requested for this boundary in the frozen plan; never re-ask or defer it to a later wave. Honor declared
   max_assurance_rounds and assurance_rounds; use `assurance-policy.md`. Preauthorize bounded same-session repair
   in the review packet; consume consolidated evidence without reproducing findings. Authorized repair closes by
   deterministic checks, without automatic rereview or budget reset. Failed repair or scope drift returns to the Orchestrator; COMPLETE does not reopen review.

Decide routine scheduling, ready-packet dispatch, and dependency order within the approved wave; implementation choices stay with the assigned author. Escalate an unresolved routine issue after two unsuccessful evidence-based attempts, sooner if no new evidence or safe approach exists. Each attempt needs a changed approach or hypothesis; this grants no extra agent runs, reviews, repairs, or reset of stricter limits. Escalate conflicting requirements, material scope/architecture changes, protected actions, authority conflicts, and exhausted review/repair limits immediately. Send evidence, attempts, affected work and recommendation; continue independent authorized work. Consume frozen decision holds and use `owner-stops.md`; decide within Orchestrator authority or ask the owner.

## Completion notifications and recovery

The Implementation Orchestrator evaluates the complete frozen graph with
`node <plugin root>/hooks/plan-package.cjs ready <plan dir>`, passing the
current scheduling state as JSON on stdin. Supply the assignment statuses
for all waves in `assignments`, outstanding decisions and out-of-scope slices
in `pending` (rows with `slice` IDs), and externally held resources in
`busy_resources`. Put a file or artifact in `available_inputs` only after
observing the version the consuming slice needs. A slice ID used as an input
requires that slice's `COMPLETED` status. A file input is satisfied by the
observed version or by completion of its planned producers. Use the producer's
slice ID when the consumer specifically needs that slice's output. Start
eligible ready slices across waves within the frozen authority and agent cap.
Read a ready slice's commands with
`node <plugin root>/hooks/plan-package.cjs wave <plan dir> <wave id>`.
Launch with the packet's frozen-route form unchanged. Subscribe to native response
notifications; wait and wake on each agent return. Read its result/log once and
schedule newly ready independent work immediately. Never poll logs, processes,
agent status, or worktrees, or use timer loops to simulate notifications.
If notifications are unavailable, return `WAITING_ON`; resume on the actual return.
One liveness check after disconnection may recover state; it never permits relaunch.
Follow the [landing order](task-state.md#landing-a-closed-unit). Finish the change
and focused checks, then push and open a draft PR to get its number. Complete the
requested review and any review repair, then commit the `CHANGELOG` link and
number-dependent text. Gate once after the review repair on that final head.
When gating locally, run exit commands after that last commit and push the verified
commit to the draft. If a push runs the gate, reuse its result for the unchanged
head with matching input hashes. Mark ready and merge only under express authority
on the same head with its exact-head receipt. A head change after gating is a
procedure defect. Keep raw logs out of commits.
Return `READY`, `REROUTED`, `WAITING_ON`, or `OWNER_DECISION_REQUIRED` with verdict, candidate_ref,
changed_paths, tests, findings, and blocker, plus completed/remaining work and next action. Use `owner-stops.md` for authority or intent stops.
Never implement, self-assure, select models, expand scope, or invent attempt limits.

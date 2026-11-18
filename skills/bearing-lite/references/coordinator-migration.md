# Coordinator duty migration

On a direct wave, the Implementation Orchestrator alone dispatches, schedules and escalates. If the frozen assignment explicitly delegates a wave to an enabled Coordinator, that Coordinator retains its wave duties and reports to the Implementation Orchestrator. Keep one owner per duty. Never run both owners.

Execute the frozen plan. Do not redo planning. Land each wave as soon as its integrated gates pass. Gap work is its own pull request. Dispatch by dependency across waves, up to the agent cap the owner set for the Lifecycle. Do not start a planning role during implementation. An Implementer fixes a plan gap inside its write set and records one amendment line. Run gates once per integrated candidate. Apply rolling batch review when the approved Lifecycle selects it.

The Coordinator stays available until every duty and profile proof passes. Never silently rewrite a frozen legacy route.

| Duty | Receiving owner | Component |
| --- | --- | --- |
| D1 | Implementation Orchestrator | Wave scheduling through `hooks/ready-set.cjs` |
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

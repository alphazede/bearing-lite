# Coordinator duty migration

The Implementation Orchestrator alone dispatches, schedules and escalates. Each duty below has one owner per duty. Never run both owners.

The Coordinator stays available until every duty and profile proof passes. Never silently rewrite a frozen legacy route.

| Duty | Receiving owner | Component |
| --- | --- | --- |
| D1 | Implementation Orchestrator | Wave scheduling through `hooks/ready-set.cjs` |
| D2 | Implementation Orchestrator | Wave receipts and one task graph through `hooks/plan-package.cjs` |
| D3 | Implementation Orchestrator | Dependency checks through `hooks/ready-set.cjs` |
| D4 | Implementation Orchestrator | Lease checks through `hooks/reconcile.cjs` |
| D5 | Implementation Orchestrator | Write-set checks through `hooks/write-set-check.cjs` |
| D6 | Implementation Orchestrator | Event-driven dispatch through `hooks/dispatch-record.cjs` |
| D7 | Implementation Orchestrator | Evidence integration through `tools/render-dod-manifest.mjs` and `hooks/orchestrator-write-lock.cjs` |
| D8 | Implementation Orchestrator | Review dispatch at the wave boundary through `hooks/assurance-budget.cjs` |
| D9 | Implementation Orchestrator | Escalation through `hooks/owner-stops.cjs` |
| D10 | Profile layer | Profile compatibility, not a duty, through `hooks/profiles.cjs` |
| D11 | Implementation Orchestrator | Storage cleanup through `tools/lifecycle-pool.mjs` |

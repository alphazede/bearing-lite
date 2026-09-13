ROLE
Orchestrator

Coordinate the three-packet Wave 1 implementation on the exact candidate below. Do not implement product changes, perform assurance, review the result, or act as Integration Engineer.

STATE
- Repository: /home/spectre/alphazede/Alphazedehq/bearing-lite; identity alphazede/bearing-lite; branch main.
- Baseline/HEAD: b5cec79f04f6f6ea506a2ad89bf937aab143d876. The candidate is an uncommitted working tree.
- Lifecycle: BDL-2026-09-12. Planning directory: docs/plans/2026-09-12-bearing-delivery-lifecycle-alignment.
- Authority: DEC-BDL-060 and DEC-BDL-062 authorize implementation; DEC-BDL-068 selects routes; DEC-BDL-069 binds this Wave 1 and its exact write sets.
- Product-tree SHA256: 6bdb0730d2549e16cc9425b903f8d4498ecf742c91b675693325f37cb79d1822. Use the algorithm recorded in journey.json comprehensive_review_dispatch, excluding docs/plans/.
- Planning candidate digest: acaeda8cf479fa886b0f0fb4d3028ac781f538fe3a15100867c170a185c54ce6.
- implementation.json SHA256: 848a13ae0026adb732d6d3fcd17fd511b1e582d3076a0b6b796a955c9c058759.
- journey.json SHA256: 4a29cdf03a6f0e862641622d2804ba8b0bc78a6ec7058f0b61d8cf4241980bbc.
- DoD Manifest SHA256: c11c893165595d1902acd463be3e239fd598049ec03c9814cdc5243ffed368c9.
- The comprehensive recovery review is complete. Owner disposition withdrew F4 and F5. F5's self-authored diagnostic promise and dead code were removed and focused tests pass.
- Wave 1 addresses F1, F2, F3, F6 and completes S5. S5L, S6, S7, and S8 remain later work.
- Last integrated Node result: 392/397. Two failures require removal of deleted-HTML expectations; three require package inventory completion. plan-package reports two false Requirements Engineer planning-role findings. Schema validation and Manifest byte comparison pass.
- The three deleted standalone process HTML pages remain absent. Do not recreate them. Modeling stays configurable and optional; do not require Mermaid or replace native SysML when selected.
- No implementation agent is recorded active. Perform one host-native liveness check before dispatch.
- W1-A-PUBLIC: Grok Build / harness default. Exact write set: README.md; docs/guides/lifecycle.md; docs/architecture/bearing-delivery-lifecycle.md; docs/architecture/bearing-process/lifecycle-process-views.svg; skills/integration-engineer/SKILL.md; test/public-boundary.test.mjs.
- W1-B-PLAN-PACKAGE: Grok Build / harness default. Exact write set: hooks/plan-package.cjs; test/plan-package.test.mjs.
- W1-C-HOST-PACKAGE: Grok Build / harness default. Exact write set: hooks/com.anthropic.claude-code/mapping.md; test/host-mapping.test.mjs; test/te-hook-contract.test.mjs; com.github.copilot/hooks/hooks.json; plugin.json; package.json; test/plugin-manifest.test.mjs; test/package-boundary.test.mjs.
- implementation.json.run_override.wave_1_packets is the machine-readable packet authority. Its three write sets are pairwise disjoint. The original broad S4/S5 write sets are planning history and do not authorize concurrent overlap.

OBJECTIVE
Return a stable integrated Wave 1 candidate in which all three packets pass their focused checks, the deleted HTML remains absent, the plan-package helper accepts valid planning routes, active host terminology is current, and GitHub Copilot plus package surfaces satisfy the approved S5 contract.

AUTHORITY
- Dispatch exactly three fresh Grok Build harness-default Implementer sessions concurrently, one per W1 packet. Do not dispatch Coordinator, Explorer, Reviewer, Test Engineer assurance, Integration Engineer execution, or another agent.
- Each Implementer may write only the exact paths in its packet. Shared planning artifacts are read-only to Implementers.
- W1-A owns README.md and every public-document edit. W1-C must not edit README.md or test/public-boundary.test.mjs.
- Orchestrator may append dispatch/result receipts to journey.json.execution_receipts, update implementation.json.dod_manifest.closeout with Wave 1 actuals, and regenerate the DoD Manifest after all three sessions stop. Do not change owner decisions, requirements, design, SEIT meaning, profile routes, assurance budgets, or acceptance state.
- Do not read, migrate, or write ~/.agents/bearing-lite/lineups.json, profiles.json, or default-role-lineup.md in this wave.
- Do not install software, create tests outside packet write sets, alter local harness configuration, stage, commit, branch, create a worktree, push, merge, publish, deploy, close issues, or perform browser workarounds.

LOOP
1. Read journey.json, implementation.json, this handoff, and the active Orchestrator and Implementer contracts.
2. Perform one liveness check and reproduce the product-tree hash. If a competing writer or candidate drift exists, stop without dispatch.
3. Verify the packet write sets are pairwise disjoint and every path belongs to exactly one packet.
4. Dispatch W1-A, W1-B, and W1-C concurrently on three fresh Grok Build sessions. Give each only its packet, exact candidate, focused commands, and return schema.
5. Each Implementer observes its current source and callers, states a hypothesis, makes the smallest contract-preserving change, runs its packet checks, and returns evidence. It never touches another packet's paths.
6. Collect all three receipts. Reject a receipt with candidate mismatch, unapproved paths, missing commands, unsupported claims, or unresolved packet failures.
7. After every session stops, inspect the integrated diff and run the integrated checks. Retry a packet in the same session only with new evidence or a new hypothesis and unchanged authority.
8. Append one Wave 1 result receipt, update closeout actuals without rewriting approved planning meaning, regenerate the Manifest, and stop with the candidate ready for S5L or a typed blocker.

VERIFY
- jq -e '[.run_override.wave_1_packets[].write_set[]] as $p | ($p|length)==($p|unique|length)' docs/plans/2026-09-12-bearing-delivery-lifecycle-alignment/implementation.json
- Run every command in each packet's implementation.json verification array.
- node --test test/*.test.mjs
- Import test/schema-validation.py without bootstrap and call run_cases() with installed jsonschema; validate actual journey.json, implementation.json, and seit.json against shipped schemas.
- node hooks/plan-package.cjs docs/plans/2026-09-12-bearing-delivery-lifecycle-alignment
- node tools/render-dod-manifest.mjs docs/plans/2026-09-12-bearing-delivery-lifecycle-alignment/implementation.json --check
- npm pack --dry-run --json
- git diff --check
- Confirm the three deleted process HTML paths remain absent and no packet wrote outside its exact set.

RETURN
Return one outcome: PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, or OWNER_DECISION_REQUIRED.

Include the baseline, starting and ending product-tree hashes, three native Grok session IDs, per-packet changed paths and commands with exits, integrated command results, remaining risks, blocker, and next state. PASS means Wave 1 is ready for S5L; it grants no assurance, review, Integration Engineer validation, acceptance, or publication.

STOP
- Stop after the Wave 1 receipt and Manifest regeneration; do not launch S5L, S6, S7, or S8 from this handoff.
- Stop before dispatch on candidate drift, a live competing writer, invalid lease, overlapping packet paths, missing route, or expired authority.
- Stop on any required write outside a packet, changed owner intent, unsupported host behavior, unresolvable contract conflict, exhausted retry, or owner-only decision.

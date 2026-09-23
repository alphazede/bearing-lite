# Workspace Environment: Assurance gate chain and review flow

## Repository Identity
- Root: `/home/spectre/src/bearing-lite-agr` (git worktree of `alphazede/bearing-lite`, package `@alphazede/bearing-lite` 1.1.3 per `package.json`)
- Plan directory: `docs/plans/2026-09-22-assurance-gate-and-review-flow/`
- Scope issues: #143, #144, #145, #136, #135 (journey `AGR-2026-09-22`, `journey.json` owned by the Orchestrator)

## Mapped Inputs
- `package.json`: no `scripts`, no dependencies; `files` publishes `plugin.json`, `skills/`, `hooks/`, `schemas/`, `templates/`, `tools/`, `profiles.json`.
- `.github/workflows/bearing-quality.yml`: CI gate order (frozen pnpm install, node tests, isolated schema validation, `pnpm audit`, `npm pack --dry-run`, `git diff --check`).
- `CONTRIBUTING.md`: provider-neutral public artifacts; no new dependencies or lockfile changes without maintainer approval; local check commands.
- `skills/architectural-alignment/templates/workspace.md`: this file's shape.
- `skills/bearing-lite/references/assurance-policy.md`: authoritative JSON budget block (cadence `slice|phase|lifecycle`; defaults TE assurance `phase`, Reviewer `phase`, IE execution `lifecycle`; 1 round, 1 aggregated repair, `deterministic_PASS` post-repair gate). No gate order, no mixed-cadence rule, no mutation/coverage/TDD text.
- `hooks/policy.cjs`: `ASSURANCE_BUDGET_POLICY` and `PLANNING_REVIEW_POLICY` frozen objects (the runtime mirror of the policy JSON blocks).
- `hooks/assurance-budget.cjs`: `evaluateAssuranceBudget()`; states it is the "Exact runtime mirror" of `assurance-policy.md` (line 5); budget and cadence only, no gate chain.
- `hooks/planning-review.cjs`: `evaluatePlanningReview()` checks the register (specification journeys), reviewer slots, rounds, receipts, aggregation, and repair gate. It has no DoD Manifest check (no `dod`/`manifest` match observed).
- `hooks/plan-package.cjs`: `verifyDigests()` requires only `seit.json` and `implementation.json` (function line 104, loop lines 106-107). Its `manifest_digest` is a SHA-256 over planning inputs plus `seit.json`, not a DoD Manifest artifact (lines 134-136). It checks register existence (lines 143-148) but has no live register-pin sweep (#135).
- `hooks/verification.cjs`, `hooks/verification-bridge.cjs`: deterministic verification evaluator and seal (statuses `VERIFIED|REFUTED|INCONCLUSIVE|ERROR`, authorities `diagnostic|assurance`, stages including `assurance`, `review`, `post_repair_closure`). Reverify is one optional backend.
- `hooks/owner-stops.cjs`: `evaluateOwnerStop()`, `ownerWaitMetrics()`; has no manifest or review-presentation guard.
- `skills/reviewer/SKILL.md`: step 1 "Consume the Assurance Test Engineer receipt" (line 29) (#145). Step 3 requires reachability and precise locations (lines 35-36). Step 5 lists `reproducer` in the frozen receipt (lines 41-44), with no rule for findings that lack one (#144). Step 4 covers OCR coverage assist (lines 37-40).
- `skills/test-engineer/SKILL.md`: the Planning session defines deterministic claims (Reverify only for binary-level claims); the Assurance session reruns claims, and author receipts cannot PASS. No mutation, changed-line coverage, or red-then-green claim types (#143).
- `skills/implementer/SKILL.md`: line 24, `tdd` orders Test Implementer before Product Implementer. No red-then-green receipt (#143).
- `skills/planning-and-design/SKILL.md`: step 4 freezes via `plan-package.cjs`, then generates `implementation.json` plus the DoD Manifest input. Step 6 says "Open and verify the Manifest" in prose only (#136).
- `skills/planning-and-design/references/artifact-grammar.md`: DoD Manifest is `<plan-name>-dod-manifest.html`, two states (planning, append-only closeout).
- `schemas/implementation.schema.json`: `dodManifest` def (line 157), `output_name` pattern `*-dod-manifest.html`, property `dod_manifest` (line 347).
- `tools/render-dod-manifest.mjs` + `templates/dod-manifest-v1.html`: deterministic renderer (template 1.0.1) consuming `implementation.json.dod_manifest`.
- `schemas/seit.schema.json`: `method` is `$ref: contentfulString` (line 62), with no claim-type enum (#143).
- `schemas/profiles.schema.json`: `cadence` def (line 97) per `assuranceSession` (lines 154-176, `cadence` line 175). No cross-field cadence constraint (#145). `reverify` (line 345) and `coverage_assist` (line 364) settings.
- `schemas/verification.schema.json`: authority and status enums mirror `verification.cjs`.
- `skills/bearing-lite/references/review-policy.md`, `verification.md`, `owner-stops.md`, `profiles.md`: planning-review policy block, verification receipt fields, owner-stop classes, and the profile digest rule.
- `hooks/hooks.json`, `hooks/com.cursor/hooks.json`: host-wired hooks are only `com.anthropic.claude-code/host.cjs`, `te-host.cjs`, `git-sync.cjs`, and `orchestrator-write-lock.cjs`. `planning-review.cjs` and `plan-package.cjs` are procedural (skill-invoked), not host-wired.

## Observed Systems
- `skills/`: role procedures (Reviewer, Test Engineer, Implementer, Planning and Design, Orchestrator `bearing-lite` + `references/`).
- `hooks/`: pure CommonJS evaluators plus host adapters (`com.anthropic.claude-code/`, `com.cursor/`).
- `schemas/`: Draft 2020-12 artifact schemas (seit, implementation, profiles, verification, journey, authority, event). No Reviewer receipt schema exists.
- `templates/`, `tools/`: DoD Manifest template and renderer.
- `test/`: `node:test` suites plus `schema-validation.py`.

## Affected Scope Map (per issue)
- #143 gate chain: `assurance-policy.md`, `hooks/policy.cjs`, `hooks/assurance-budget.cjs`, `skills/test-engineer/SKILL.md`, `skills/implementer/SKILL.md`, `schemas/seit.schema.json`, `hooks/verification*.cjs` + `schemas/verification.schema.json`, `references/verification.md`. Tests: `test/assurance-budget.test.mjs`, `test/policy-drift.test.mjs` (mirror), `test/verification*.test.mjs`, `test/tdd-test-implementer-route.test.mjs`, `test/skills-conformance.test.mjs`.
- #144 evidence-bound findings: `skills/reviewer/SKILL.md`, the Reviewer receipt shape (no schema exists; `reproducer` appears only in the skill and `test/reviewer-repair-transition.test.mjs`), `assurance-policy.md`. Tests: `test/reviewer-repair-transition.test.mjs`, `test/skills-conformance.test.mjs`.
- #145 mixed cadence: `schemas/profiles.schema.json`, `hooks/profiles.cjs` (unread), `assurance-policy.md`, `skills/reviewer/SKILL.md`, `hooks/assurance-budget.cjs`. Tests: `test/assurance-budget.test.mjs`, `test/profiles-empty.test.mjs`, `test/profile-capability-*.test.mjs`.
- #136 manifest before owner review: `hooks/planning-review.cjs`, `hooks/policy.cjs` (`PLANNING_REVIEW_POLICY`), `hooks/plan-package.cjs`, `skills/planning-and-design/SKILL.md` step 6, `references/owner-stops.md`, `references/review-policy.md`, `schemas/implementation.schema.json` `dodManifest`, `tools/render-dod-manifest.mjs`, and the harness adapters. Tests: `test/planning-review.test.mjs`, `test/plan-package.test.mjs`, `test/dod-manifest.test.mjs`, `test/hook-contract.test.mjs`.
- #135 register pins: `hooks/plan-package.cjs` (`verifyDigests`, `checkFrozenHashes`), `hooks/write-set-check.cjs` (write-set scope), `artifact-grammar.md`, `references/*` guidance. Tests: `test/plan-package.test.mjs`, `test/write-set-check.test.mjs`.

## Constraints and Git Boundaries
- Branch / Worktree: `feat/assurance-gate-review-flow` @ `174773e` (dirty only by this untracked plan directory).
- Rules: `CONTRIBUTING.md`. Public artifacts must not name or require a concrete agent, model, or provider. No new dependencies or lockfile changes without maintainer approval. No `mcp.json`, postinstall scripts, or global hook installers. The Mermaid/PNG pair must stay in sync. Hook fail-open versus integrity fail-closed is a hard-review area.
- Policy mirror rule: `assurance-policy.md` JSON block is authoritative; `hooks/policy.cjs` / `assurance-budget.cjs` must mirror it (`test/policy-drift.test.mjs`).
- Typed-gap rule (existing): declared-but-unavailable or `not_run` is never PASS (`skills/reviewer/SKILL.md` step 4; `hooks/verification.cjs`).
- Planning review and implementation assurance budgets are separate (`assurance-policy.md` § Planning review stays separate).

## Validation Commands [observed, not run]
- Test: `node --test test/*.test.mjs` (source: `.github/workflows/bearing-quality.yml`, `CONTRIBUTING.md`) [observed, not run]
- Test (focused): `node --test test/public-boundary.test.mjs test/skills-conformance.test.mjs` (source: `CONTRIBUTING.md`) [observed, not run]
- Schema: `python3 test/schema-validation.py` (Python 3.12, isolated `--require-hashes` install) (source: `.github/workflows/bearing-quality.yml`, `CONTRIBUTING.md`) [observed, not run]
- Write-set hygiene: `node hooks/write-set-check.cjs -- <paths the slice wrote>` (source: `CONTRIBUTING.md`) [observed, not run]
- Lint/whitespace: `git diff --check` (source: `.github/workflows/bearing-quality.yml`) [observed, not run]
- Package: `pnpm install --frozen-lockfile`, `pnpm audit --audit-level=moderate`, `npm pack --dry-run --json` (source: `.github/workflows/bearing-quality.yml`) [observed, not run]
- Build: none observed (no `scripts` in `package.json`).

## Unknowns
- #145: which rule to adopt (consume the most recent deterministic receipt, or reject a Reviewer cadence finer than TE assurance). This is an owner/scope decision and is not decided here.
- #144 optional external semantic classifier: the issue names a concrete classifier, which conflicts with the `CONTRIBUTING.md` provider-neutrality rule unless it is expressed as a capability. Scope Definition must resolve this.
- #143: bearing-lite has no dependencies and no mutation or coverage tool. The gate must bind to the target repository's own tools, and adding one here requires maintainer approval. The shape of the gate-chain receipt is undefined.
- #144: no Reviewer receipt schema exists, so where actionable versus advisory findings are encoded (new schema versus skill text plus test) is undecided.
- #136: whether the guard lives in `planning-review.cjs` or a separate pre-review guard. "Propagate to other harness adapters" has no host-wired target today, because `planning-review.cjs` is procedural.
- #135: the allow-list format for historical records, and how a sweep reaches write-set paths outside `docs/plans/**`.
- `hooks/profiles.cjs`, `hooks/reconcile.cjs`, `skills/coordinator/SKILL.md`, `skills/bearing-lite/SKILL.md` were not read within the discovery bounds.
- Systems Modeler: not triggered. Existing architecture (policy block, evaluator-hook mirror, schemas, and renderer) covers the affected scope. The missing pieces are requested features for Planning and Design, not unmapped architecture.

## Map Freshness
- Tier 1: Recorded root and plan directory match confirmed inputs.
- Tier 2: `git status --porcelain` scoped to mapped inputs shows no modifications (observed 2026-09-22 @ `174773e`).
- Note: Does not detect committed changes postdating this observation.

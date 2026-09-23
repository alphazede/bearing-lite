---
type: technical-plan
status: complete
---

# Assurance gate chain and review flow — Technical Plan

Lifecycle `AGR-2026-09-22`. Baseline `alphazede/bearing-lite` main @ `174773e`
(worktree `/home/spectre/src/bearing-lite-agr`, branch
`feat/assurance-gate-review-flow`). Scope: #143, #144, #145, #136, #135, #146
(DEC-AGR-002, DEC-AGR-005). Out of scope: #139, #122, #92, npm release
(DEC-AGR-012). Strategy `tdd`; reverify enabled; coverage_assist enabled, not
required (journey.json `profile_selection`, authoritative).

## Requirements register

No requirements register exists for this repository/Lifecycle. Evidence: no
`*.sdoc` file in the repo; no register artifact or `REG-*` identities in the
plan directory; `hooks/plan-package.cjs` requires a register only when
`journey_settings.journey_type` is `specification`, and this Lifecycle is
feature work. Per artifact-grammar §Requirements register rule 2,
requirements are authored below as Lifecycle-local `AC-*`/`RISK-*` criteria.

## Requirements

### #143 — Deterministic assurance gate chain (DEC-AGR-010)

- AC-143.01 [traces #143, DEC-AGR-010]: `assurance-policy.md` declares the
  fixed fail-fast gate order build → types/lint → red-then-green →
  mutation score → changed-line coverage → Reverify (applicable binary-level
  claims only) → Reviewer, and `hooks/assurance-budget.cjs` mirrors it with
  `test/policy-drift.test.mjs` in sync.
- AC-143.02 [traces #143, DEC-AGR-010]: the Planning Test Engineer session
  supports mutation, changed-line coverage, and red-then-green claim types in
  `seit.json`, each with a typed-gap outcome.
- AC-143.03 [traces #143, DEC-AGR-010]: a declared gate with a missing tool
  or `not_run` outcome is a typed gap, never PASS.
- AC-143.04 [traces #143, DEC-AGR-010]: the Assurance Test Engineer reruns the
  chain independently at the boundary; author diagnostic receipts cannot PASS.
- AC-143.05 [traces #143]: tests cover a missing tool, a threshold failure,
  and fail-fast ordering.
- AC-143.06 [traces #143, DEC-AGR-010]: mutation and changed-line coverage
  are declared per plan in `seit.json` (repository tool + threshold);
  declared = hard gate; undeclared requires `NOT_APPLICABLE` with reason.
- AC-143.07 [traces #143]: the red-then-green receipt records a failing run
  against the baseline and a passing run against the candidate.

### #144 — Evidence-bound Reviewer findings (DEC-AGR-009)

- AC-144.01 [traces #144, DEC-AGR-009]: a finding counts toward
  `REPAIR_REQUIRED`/`BLOCK` only with `file:line` plus a failing test or
  reproducer; anything else is recorded advisory and spends no repair budget.
- AC-144.02 [traces #144, DEC-AGR-009]: a verdict built only on advisory
  findings cannot be `REPAIR_REQUIRED` or `BLOCK`.
- AC-144.03 [traces #144, DEC-AGR-009]: Reviewer scope narrows to what
  deterministic gates cannot prove (requirement conformance, design, security
  reasoning, plan drift); it consumes the gate-chain receipt, does not
  re-litigate passed gates; the Assurance Test Engineer does not re-review
  code. The optional external semantic classifier is DEFERRED (destination
  bearing-lite #122); no classifier is named or required here.
- AC-144.04 [traces #144]: tests cover a reproducer-less finding downgraded
  to advisory.

### #145 — Reviewer contract under mixed cadence (DEC-AGR-008)

- AC-145.01 [traces #145, DEC-AGR-008]: at a boundary with no Assurance Test
  Engineer receipt, the Reviewer consumes the #143 deterministic gate-chain
  receipt for that unit; neither receipt is a typed gap, never PASS; the gate
  chain therefore runs at every Reviewer boundary.
- AC-145.02 [traces #145]: the rule appears in `assurance-policy.md` and the
  Reviewer skill; a test covers lifecycle TE assurance with a phase Reviewer.

### #136 — Manifest before owner review (DEC-AGR-011)

- AC-136.01 [traces #136, DEC-AGR-011]: the owner-review gate is unreachable
  until the DoD Manifest is generated. Canonical manifest: the
  `implementation.json` `dod_manifest` projection plus the rendered
  `<plan-name>-dod-manifest.html` via `tools/render-dod-manifest.mjs`.
- AC-136.02 [traces #136]: `hooks/planning-review.cjs`
  `evaluatePlanningReview()` fails closed with `NEEDS_MORE_EVIDENCE`, reason
  `manifest_not_generated`, when the manifest is absent; a unit check covers
  it. Guard location is this plan's decision per DEC-AGR-011.
- AC-136.03 [traces #136]: `skills/planning-and-design` step 6 references the
  enforced guard, not just prose.
- AC-136.04 [traces #136]: the guard is referenced from every procedural
  review-presentation path. `planning-review.cjs` is procedural
  (skill-invoked), not host-wired, so there is no host adapter target to
  patch; propagation is via the skill text.

### #135 — Live register pins as tool check (DEC-AGR-011)

- AC-135.01 [traces #135, DEC-AGR-011]: `hooks/plan-package.cjs` fails when
  any live register pin in the package disagrees with the recorded baseline,
  naming every offender with `file:line`; historical records (gate evidence
  files, dated receipt rows, markers in the existing `HISTORICAL_GATE` set)
  are allow-listed and never reported. Allow-list format is this plan's
  decision per DEC-AGR-011.
- AC-135.02 [traces #135]: companion artifacts cite the `authority.json`
  baseline or the bound host by reference instead of carrying their own
  register-digest copy; the references guidance says so.
- AC-135.03 [traces #135]: the sweep covers the whole repository write set,
  not just the plan directory.
- AC-135.04 [traces #135]: moving a register by one byte without cascading
  fails with named pins; re-running after a correct cascade passes.

### #146 — Orchestrator-owned Architectural Alignment (DEC-AGR-007)

- AC-146.01 [traces #146, DEC-AGR-007]: the Orchestrator can create and
  update `workspace.md` and `repository-map.md`; the hook and the
  Architectural Alignment skill agree the stage is Orchestrator-owned.
- AC-146.02 [traces #146, DEC-AGR-007]: the hook learns an in-process
  subagent role from the host envelope where the harness exposes one;
  otherwise the fallback is a separate process with `BEARING_ROLE`, named in
  the deny message; a subagent is never silently treated as the Orchestrator.
- AC-146.03 [traces #146]: tests cover an Orchestrator write to
  `workspace.md` and the host-without-role case for the remaining locked
  artifacts.

### Authority (DEC-AGR-012)

- AC-AUTH.01 [traces DEC-AGR-012]: the Lifecycle lands on main by PR once
  checks are green; no npm release occurs in this Lifecycle.

### Risks

- RISK-001 [provider neutrality, CONTRIBUTING.md]: public artifacts name no
  concrete agent, model, or provider; the mutation/coverage tools are declared
  per plan as the target repository's own tool, never a new bearing-lite
  dependency (maintainer approval required otherwise).
- RISK-002 [hook integrity, CONTRIBUTING.md hard-review area]: new guards
  fail closed on integrity (missing manifest, stale pin) while preserving the
  existing fail-open behavior for unavailable backends (typed gap, never
  PASS).

## Entry criteria

- Baseline `174773e` leased and clean except this plan directory; profile
  snapshot frozen in journey.json; DEC-AGR-001..012 confirmed with zero open
  decisions.

## Exit criteria

- All AC/RISK rows have passing Lifecycle-level proof in `seit.json`;
  `node --test test/*.test.mjs`, `python3 test/schema-validation.py`, and
  `git diff --check` are green; policy/hook mirror tests pass; PR to main
  opened once green.

## Rollback or repair

- Revert the Lifecycle branch to the leased revision `174773e`; delete the
  plan directory to withdraw the package. Per-slice repair follows the frozen
  review receipt under the 1-round / 1-repair budget; post-repair closure is
  deterministic only, no rereview.

## Accountable controller

- Planning Orchestrator (this node authors steps 1–3 only; no freeze, no
  `implementation.json`, no DoD Manifest — Test Engineer planning,
  Integration Engineer planning, and Plan Integrator are dispatched next).

## Proposed implementation graph

Strategy `tdd`: every Test Implementer slice precedes its Product
Implementer slice. Roles/routes/reasoning from the journey.json snapshot;
reviewer cadence `phase`; test_engineer.assurance and
integration_engineer.execution cadence `lifecycle`. Design lenses are sourced
from `design.md` (`Gate-chain`, `Receipt-contract`, `Review-gate`,
`Pin-hygiene`, `Ownership`).

Slices (stable IDs; `judgement` default; `authority_id` = Lifecycle
`AGR-2026-09-22`; stop = packet commands green or typed failure returned):

- S1 tests gate chain — role Test Implementer. Req AC-143.05. Design
  DES-143.01. Proof SEIT-143.01, SEIT-143.02, SEIT-143.03, SEIT-143.04,
  SEIT-143.05, SEIT-143.06, SEIT-143.07. Lens Gate-chain.
  Write only `test/gate-chain.test.mjs`.
- S2 tests reviewer evidence + cadence — role Test Implementer. Req
  AC-144.04, AC-145.02. Design DES-144.01, DES-145.01. Proof SEIT-144.01,
  SEIT-144.02, SEIT-144.03, SEIT-144.04, SEIT-145.01, SEIT-145.02. Lens
  Receipt-contract.
  Write only `test/reviewer-evidence.test.mjs`.
- S3 tests manifest guard + pin sweep — role Test Implementer. Req
  AC-136.02, AC-135.01, AC-135.04. Design DES-136.01, DES-135.01. Proof
  SEIT-136.01, SEIT-136.02, SEIT-136.03, SEIT-136.04, SEIT-135.01,
  SEIT-135.02, SEIT-135.03, SEIT-135.04. Lens Review-gate, Pin-hygiene.
  Write only `test/manifest-pin-guard.test.mjs`.
- S4 tests orchestrator write lock — role Test Implementer. Req AC-146.03.
  Design DES-146.01. Proof SEIT-146.01, SEIT-146.02, SEIT-146.03. Lens
  Ownership.
  Write only `test/orchestrator-write.test.mjs`.
- S5 gate-chain policy + hook mirror — role Product Implementer. Req
  AC-143.01, AC-143.03, AC-143.06, AC-143.07, AC-145.01. Design DES-143.01,
  DES-143.02, DES-145.01. Proof SEIT-143.01, SEIT-143.03, SEIT-143.06,
  SEIT-143.07, SEIT-145.01. Lens Gate-chain.
  Write only `skills/bearing-lite/references/assurance-policy.md`.
  Write only `hooks/policy.cjs`.
  Write only `hooks/assurance-budget.cjs`.
- S6 TE/Implementer claim types — role Product Implementer. Req AC-143.02,
  AC-143.04. Design DES-143.02. Proof SEIT-143.02, SEIT-143.04. Lens
  Gate-chain, Receipt-contract. (AC-143.07 evaluator lives in S5, prose
  only here.)
  Write only `skills/test-engineer/SKILL.md`.
  Write only `skills/implementer/SKILL.md`.
  Write only `skills/bearing-lite/references/verification.md`.
- S7 reviewer evidence rule + cadence consumption — role Product
  Implementer. Req AC-144.01, AC-144.02, AC-144.03. Design DES-144.01.
  Proof SEIT-144.01, SEIT-144.02, SEIT-144.03. Lens Receipt-contract.
  Write only `skills/reviewer/SKILL.md`.
- S8 manifest guard + skill step 6 — role Product Implementer. Req
  AC-136.01, AC-136.02, AC-136.03, AC-136.04. Design DES-136.01. Proof
  SEIT-136.01, SEIT-136.02, SEIT-136.03, SEIT-136.04. Lens Review-gate.
  Scope includes correcting the step-4 sequence in
  `skills/planning-and-design/SKILL.md` (generate `implementation.json`
  before the `plan-package.cjs` freeze, per the hook's interface).
  Write only `hooks/planning-review.cjs`.
  Write only `skills/planning-and-design/SKILL.md`.
  Write only `test/planning-review.test.mjs`.
- S9 pin sweep + cite-don't-copy guidance — role Product Implementer. Req
  AC-135.01, AC-135.02, AC-135.03, AC-135.04. Design DES-135.01. Proof
  SEIT-135.01, SEIT-135.02, SEIT-135.03, SEIT-135.04. Lens Pin-hygiene.
  Write only `hooks/plan-package.cjs`.
  Write only `skills/planning-and-design/references/artifact-grammar.md`.
- S10 orchestrator-owned alignment — role Product Implementer. Req
  AC-146.01, AC-146.02. Design DES-146.01. Proof SEIT-146.01, SEIT-146.02.
  Lens Ownership.
  Write only `hooks/orchestrator-write-lock.cjs`.
  Write only `skills/architectural-alignment/SKILL.md`.

Dependencies (acyclic):

```text
S1 --> S5
S1 --> S6
S2 --> S7
S3 --> S8
S3 --> S9
S4 --> S10
S5 --> S7
```

Waves:

```text
Wave 1: S1, S2, S3, S4
Wave 2: S5, S6, S8, S9, S10
Wave 3: S7
```

Wave 1 slices are parallel-safe (disjoint new test files). Wave 2 slices are
parallel-safe (disjoint write sets; S5 owns `assurance-policy.md`, so the
#145 policy sentence rides in S5 while the Reviewer-skill half of AC-145.02
proof is exercised by S2 tests and S7 consumes S5's receipt shape in Wave 3).
No slice adds a dependency or names a concrete provider/model (RISK-001).

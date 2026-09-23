# Integration Engineer planning assembly — AGR-2026-09-22

**Outcome:** `REPAIRABLE_FAILURE` for the planning-package sequence below. The
slice write sets and implementation wave order are usable. This is planning
evidence only; the execution session must use a fresh, independent session on
the exact integrated candidate and must not self-certify it.

## Identity, readiness, and order

- Source baseline: `feat/assurance-gate-review-flow` at `174773e`. The only
  working-tree addition at inspection was this plan directory. Bind execution
  to the approved `implementation.json`, its candidate ref/revision/digest,
  the `journey.json` profile snapshot, and the exact 17 source/test paths below.
  Reject a changed baseline, route, cadence, or backend selection without an
  explicit amendment. Preserve `deterministic_verification.reverify.enabled`
  and `review.coverage_assist.enabled/required` with the role routes in every
  frozen binding and relevant packet. Selected backend availability and
  `not_run` must be resolved as typed gaps, never PASS. Reverify applies only
  to declared binary-level claims; this SEIT has none.
- Entry: approved package and authority, complete slice packets, frozen
  profile, tested baseline, and no unrelated edits. No stubs or simulators are
  needed for assembly; the SEIT's missing-tool, stale-pin, and missing-manifest
  cases use test fixtures. No integration glue is authorized by these slices.
- W1 `S1–S4`: four new, separate files:
  `test/gate-chain.test.mjs`, `test/reviewer-evidence.test.mjs`,
  `test/manifest-pin-guard.test.mjs`, `test/orchestrator-write.test.mjs`.
  Capture the expected failing test receipts before product changes; a red
  result is TDD evidence, not an integrated PASS.
- W2 `S5,S6,S8,S9,S10`: respectively
  `assurance-policy.md` + `policy.cjs` + `assurance-budget.cjs`;
  `test-engineer/SKILL.md` + `implementer/SKILL.md` + `verification.md`;
  `planning-review.cjs` + `planning-and-design/SKILL.md`;
  `plan-package.cjs` + `artifact-grammar.md`;
  `orchestrator-write-lock.cjs` + `architectural-alignment/SKILL.md`.
  These are twelve distinct existing paths. Complete each W1 predecessor before
  its W2 product slice: `S1→S5,S6`, `S3→S8,S9`, `S4→S10`.
- W3 `S7`: `skills/reviewer/SKILL.md` alone. `S2→S7` and `S5→S7` are explicit;
  the W2 barrier also finishes S6 before S7. The Reviewer may consume only a
  gate-chain receipt shape that S5 actually supplies. Test the lifecycle-TE /
  phase-Reviewer case before accepting W3.

The plan's ten declared slices contain **17 unique paths, zero overlaps**;
all four W1 paths are currently absent, and all 13 product paths exist. There
is no missing inter-slice edge under the declared wave barriers. A graph-only
dispatcher must retain those barriers, especially W2 completion before S7.

## Interface checks and V&V handoffs

1. **Gate chain:** `skills/bearing-lite/references/assurance-policy.md` has the
   authoritative JSON block; `hooks/policy.cjs` is its exact object mirror;
   `hooks/assurance-budget.cjs` imports that object. Existing
   `test/policy-drift.test.mjs` enforces equality and import, so S5 need not
   write the drift test. Check that S1 exercises missing tool, threshold,
   fail-fast order, and the receipt S7 consumes. Hand W2 gate receipts to the
   declared Reviewer boundary; author receipts remain diagnostic.
2. **Write ownership:** `hooks/orchestrator-write-lock.cjs` currently assigns
   `workspace.md` and `repository-map.md` to Architectural Alignment and
   permits any non-Orchestrator `BEARING_ROLE`. S10 must align the hook's
   in-process role resolution and deny fallback with
   `skills/architectural-alignment/SKILL.md`; S4 covers both allowed and
   host-without-role cases. Verify the remaining locked artifact denials.
3. **Planning package:** `hooks/plan-package.cjs` currently requires both
   `seit.json` and `implementation.json` and checks the latter's candidate
   digest. `tools/render-dod-manifest.mjs --check` compares the rendered HTML
   to `implementation.json.dod_manifest`; the renderer is outside the write
   set. S8's `evaluatePlanningReview()` guard must inspect both the projection
   and rendered output before review presentation. S9's live-pin sweep must
   cover repository write paths and spare historical records. Run the S3 tests
   across S8 and S9 together, then hand the valid package to planning review.
4. **Repairable sequence defect:** `skills/planning-and-design/SKILL.md` step 4
   currently orders `plan-package.cjs` freeze *before* generating
   `implementation.json`, which that hook requires. The plan directory has no
   `implementation.json` or rendered Manifest yet. S8 owns this skill but its
   packet names step 6 only. Before execution, the planning controller must
   align the packet/skill sequence with the real interface: generate the
   implementation projection, render HTML, freeze/check the package, then
   invoke the review guard. Do not weaken `verifyDigests()` to hide this gap.
   No owner intent needs to be invented, but the current packet scope does not
   explicitly cover the step-4 correction.

At each wave boundary, record the integrated candidate identity, changed
paths, focused test result, and any anomaly. A failure stops the wave; use the
frozen receipt's single aggregated repair and deterministic closure. A changed
interface or missing product behavior returns for a bounded plan correction;
do not add glue or revise tests in this role. Recovery is the technical plan's
rollback to leased `174773e` and withdrawal of this plan package, under the
controller's authority. The final candidate is the approved package plus all
three waves, with the same frozen profile and a fresh candidate digest.

## Lifecycle-end execution checks on that exact candidate

Run from the repository root after the package and all slices exist. Record
stdout, exit status, candidate ref/digest, and the W1 red / W2-W3 green
receipts. The focused seam tests are included in the full command below.

```sh
git status --porcelain=v1
git diff --name-only 174773e --
git ls-files --others --exclude-standard
node hooks/write-set-check.cjs -- test/gate-chain.test.mjs test/reviewer-evidence.test.mjs test/manifest-pin-guard.test.mjs test/orchestrator-write.test.mjs skills/bearing-lite/references/assurance-policy.md hooks/policy.cjs hooks/assurance-budget.cjs skills/test-engineer/SKILL.md skills/implementer/SKILL.md skills/bearing-lite/references/verification.md skills/reviewer/SKILL.md hooks/planning-review.cjs skills/planning-and-design/SKILL.md hooks/plan-package.cjs skills/planning-and-design/references/artifact-grammar.md hooks/orchestrator-write-lock.cjs skills/architectural-alignment/SKILL.md
node hooks/plan-package.cjs docs/plans/2026-09-22-assurance-gate-and-review-flow
node tools/render-dod-manifest.mjs docs/plans/2026-09-22-assurance-gate-and-review-flow/implementation.json --check
env -u BEARING_ROLE node --test test/*.test.mjs
python3 test/schema-validation.py
git diff --check 174773e --
```

Compare both path-list commands against the approved write sets and plan
artifacts; `git diff --check` omits untracked files. Inspect the full diff for
provider neutrality, no new dependencies/lockfile changes, gate-chain
typed-gap behavior, and hook/skill mirror agreement. The full Node suite must
include `policy-drift`, the four new test files, planning-review, plan-package,
DoD Manifest, and write-lock tests. A missing generated Manifest means the
package/render checks are pending, not passing. These diagnostic checks do
not replace the Assurance Test Engineer's independent evidence or the
Reviewer's phase receipt.

## Baseline evidence and remaining risks

- `node --test test/*.test.mjs` under this role environment: 564/565 passed;
  existing `test/harness-acceptance.test.mjs` expected a write denial but its
  spawned hook inherited `BEARING_ROLE=integration_engineer` and allowed it.
  `env -u BEARING_ROLE node --test test/*.test.mjs`: **565/565 passed**.
- `node --test test/policy-drift.test.mjs`: 3/3 passed.
  `python3 test/schema-validation.py`: 268/268 passed.
  `git diff --check`: passed on tracked baseline changes.
- S5's gate-chain receipt fields are not yet implemented; S7 consumption must
  be checked against the actual S5 output. The backend availability receipts
  and current package freeze/render result cannot be established at this
  planning stage. BRAN native policy was unavailable; repository discovery
  supplied the file and command evidence instead.

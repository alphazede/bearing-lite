ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice: distinct `required` vs `enabled` capability semantics (issue #111).

STATE
Facts:
- Baseline: commit 254c60bb1c5bd496878cb8ba9ea8c7448926f458, branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Issue #111: `required` is currently a no-op whenever `enabled` is true. Activation is `enabled || required` and unavailability is handled identically either way.
- Owner decision (final): give `required` force. `required` means the role may not proceed without the capability (halt). `enabled` means the role may proceed with a recorded note. Activated-but-unavailable stays a typed gap in both cases.
- Code pointers: `hooks/review-capability.cjs` lines 67 (`declared` shape) and 80 (OR activation); `hooks/verification.cjs` line 183 (`selected || required`) and lines 188-193 (unavailable handling). Schema: `schemas/profiles.schema.json` around line 364 (`coverage_assist`, requires only `enabled`). Contract doc: `skills/bearing-lite/references/review-capability.md`.
- Existing tests: `test/review-capability.test.mjs`, `test/verification.test.mjs`, `test/verification-bridge.test.mjs` (64 pass at baseline); full suite `node --test test/*.test.mjs`; schema gate `python3 test/schema-validation.py`.
Assumption: no live profiles outside this repo need migration; legacy handling is documentation plus explicit passthrough, not a migration script.

OBJECTIVE
`required` has an observable effect distinct from `enabled`, proven by a test: required-and-unavailable signals halt, enabled-and-unavailable signals proceed-with-note, while both keep their existing typed-gap outcome/reason strings (`UNAVAILABLE`/`typed_capability_gap` in review-capability; `ERROR`/`backend_unavailable` in verification). Both modules agree on the semantics. Schema descriptions and `references/review-capability.md` state what each flag means.

AUTHORITY
Allowed paths:
- hooks/review-capability.cjs
- hooks/verification.cjs
- schemas/profiles.schema.json
- skills/bearing-lite/references/review-capability.md
- test/required-semantics.test.mjs (new)
- existing tests under test/ (extend only where the new signal requires it)

Prohibited:
- packet dispatch logic, role skills, lifecycle freeze code
- live user profiles or install harness behavior
- unrelated cleanup or refactoring
- issue #92 scope (per-harness install testing)

LOOP
1. Observe the current code, schema, reference doc, and existing tests.
2. Write the smallest failing regression first: a test that distinguishes required-and-unavailable from enabled-and-unavailable.
3. Make the smallest allowed change satisfying the objective.
4. Run focused verification.
5. Inspect the result.
6. On failure, classify and retry only with a new hypothesis or new evidence.
7. Stop when the objective is proven or a genuine blocker exists.

VERIFY
- New test fails before the fix and passes after; the previously identical enabled/required table rows diverge.
- `node --test test/*.test.mjs` passes fully.
- `python3 test/schema-validation.py` passes.
- `git diff --check` passes.
- `git status --short` shows changes only inside the allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: changed paths, commands executed with exit codes, evidence (test counts), remaining risks, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

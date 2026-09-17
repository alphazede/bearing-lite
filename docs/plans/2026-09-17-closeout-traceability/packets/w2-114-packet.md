ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice: the #114 remainder after the frozen-helper fix.

STATE
Facts:
- Baseline: commit 10ea397 (W1 #111 committed), branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Done already (do not redo): `hooks/profiles.cjs` `freezeSelectedRoutes` copies `review` and `deterministic_verification` into snapshot and digest material; `test/profile-capability-freeze.test.mjs` covers freeze; `skills/bearing-lite/references/profiles.md:117-121` states packets must consume the binding and old roles-only snapshots need reconciliation, not hot reload; `skills/bearing-lite/SKILL.md:40` and `references/assurance-policy.md:78-82` state planning review never consumes implementation assurance; W1 added a `proceed` halt/note signal to both evaluators.
- Verify-before-change (fix only what is actually missing):
  a. Controller declaration path: the Reviewer consumes a declared packet (`skills/reviewer/SKILL.md` step 4). Check whether any instruction tells the parent controller to declare from the FROZEN snapshot rather than the live catalog; add it where missing (likely `references/review-capability.md` and/or `references/profiles.md`).
  b. Reconciliation mechanics: `profiles.md:120-121` states the principle. Add the explicit mechanic (re-freeze from the same profile + digest comparison, or dated owner amendment) if absent.
  c. OCR/backend identity: declaration must resolve OpenCodeReview/coverage-assist backend identity and availability explicitly or return a typed gap; generic naming must not hide an absent binding.
  d. Budget wording: verify the planning-vs-implementation separation is unambiguous in handoff wording; change only genuine ambiguity.
  e. The affected local desktop lifecycle reconciliation is owner-side (outside this repo): do not attempt it; record it as an owner step in your return.
- Existing tests: `test/profile-capability-freeze.test.mjs` (freeze only). Full suite `node --test test/*.test.mjs` (~500 pass); schema gate `python3 test/schema-validation.py`.

OBJECTIVE
Close every remaining #114 acceptance box that lives in this repo: frozen-snapshot-to-packet projection is instructed and tested, old roles-only snapshots have an explicit amendment path, regressions cover live-profile drift, selected-but-unavailable, and propagation to Reviewer packets, backend identity resolves explicitly or gaps, and handoff wording keeps planning and implementation review budgets separate.

AUTHORITY
Allowed paths:
- skills/bearing-lite/references/profiles.md
- skills/bearing-lite/references/review-capability.md
- skills/bearing-lite/references/verification.md
- skills/bearing-lite/references/assurance-policy.md (only genuine ambiguity)
- skills/reviewer/SKILL.md (only if packet-declaration wording needs the frozen-source rule; respect its 60-line / 600-word conformance caps — run `node --test test/skills-conformance.test.mjs`)
- skills/bearing-lite/SKILL.md (only if dispatch wording needs the frozen-source rule)
- test/ (extend with drift/unavailable/propagation regressions)

Prohibited:
- hooks/profiles.cjs freeze logic (done), hook evaluator semantics (W1, done)
- role skills beyond the reviewer exception above, live user profiles, harness behavior
- issue #92 scope, unrelated cleanup

LOOP
1. Observe the cited references and tests; for each box (a)-(e) decide: already satisfied (cite line) or missing.
2. Write the smallest failing regression first for each missing behavior.
3. Make the smallest allowed change.
4. Run focused verification, then the full suite and conformance test.
5. Stop when the objective is proven or a genuine blocker exists.

VERIFY
- New regressions fail before and pass after; they cover live-profile drift, selected-but-unavailable, and propagation of frozen capabilities toward Reviewer packets.
- `node --test test/*.test.mjs` passes fully; `test/skills-conformance.test.mjs` passes (reviewer caps intact).
- `python3 test/schema-validation.py` passes; `git diff --check` passes.
- `git status --short` shows changes only inside the allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: per-box verdict table (satisfied-cite vs changed), changed paths, commands with exit codes, evidence, remaining risks, owner-side step (e), blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

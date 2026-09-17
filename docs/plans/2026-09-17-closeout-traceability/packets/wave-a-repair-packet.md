ROLE
Product Implementer

RESPONSIBILITY
Apply the Wave A reviewer findings (one authorized repair round, docs-only).

STATE
Facts:
- Baseline: commit bc9ef20, branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Reviewer verdict: ACCEPT_WITH_FINDINGS on candidate bc9ef20. Three findings, all doc-level, no behavior change:
  1. P2: `skills/bearing-lite/references/verification.md` "Backend activation" never documents the `proceed: "halt"` (required) vs `proceed: "proceed-with-note"` (enabled-only) divergence emitted at `hooks/verification.cjs:193` (pinned by `test/required-semantics.test.mjs:102-104`). Repair: one sentence mirroring `skills/bearing-lite/references/review-capability.md:49-50`.
  2. P3: `skills/bearing-lite/references/review-capability.md` says the controller copies `enabled` and `required` from the frozen snapshot and that legacy omission is false, but never explicitly says the parent must normalize an omitted `required` to `false` before declaring (literal `{enabled:true}` without `required` hits `capability_not_declared` via pre-existing `declarationOf` fail-closed). Repair: one clause stating the normalization.
  3. P3 nit: `hooks/verification.cjs:151-163` `@returns` JSDoc omits the optional `proceed` field. Repair: add `proceed?` to the JSDoc (comment only, zero behavior change).

OBJECTIVE
All three findings repaired with doc/comment-only edits; behavior and tests unchanged.

AUTHORITY
Allowed paths:
- skills/bearing-lite/references/verification.md (one sentence)
- skills/bearing-lite/references/review-capability.md (one clause)
- hooks/verification.cjs (JSDoc comment only; no code change)

Prohibited: behavior changes, test changes, schema changes, any other file.

LOOP
1. Observe the three locations.
2. Make the smallest allowed edits.
3. Run focused verification.
4. Stop when proven or blocked.

VERIFY
- `node --test test/*.test.mjs` passes fully.
- `git diff --check` passes; `git status --short` shows only the three allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: changed paths, commands with exit codes, evidence, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- required evidence cannot be produced
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

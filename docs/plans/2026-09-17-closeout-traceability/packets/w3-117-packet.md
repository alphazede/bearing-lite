ROLE
Light Implementer

RESPONSIBILITY
Close the last #117 remainder with a doc-only slice.

STATE
Facts:
- Baseline: commit 27072cb (W2 #114 committed), branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Owner decision (final): KEEP the OpenCodeReview name in `skills/reviewer/SKILL.md` step 4 (committed in 254c60b, line 40: "OpenCodeReview (OCR) is one"). No move to packet-plus-reference only.
- Remaining work: record that per-harness host readiness (binary on PATH, Cursor allowlist) is owner-machine configuration and folds into #92 plugin-install testing, not this repo. Put that note where it belongs — likely `skills/bearing-lite/references/review-capability.md` — WITHOUT touching `skills/reviewer/SKILL.md` (its 60-line / 600-word conformance caps must hold; run `node --test test/skills-conformance.test.mjs`).
- If the note already exists somewhere, make no change and say so.

OBJECTIVE
The keep-decision stands verified and the #92 host-readiness handoff is recorded in exactly one reference location, or the slice reports no diff required.

AUTHORITY
Allowed paths:
- skills/bearing-lite/references/review-capability.md (one short note only)

Prohibited:
- skills/reviewer/SKILL.md and every other file
- any behavior, test, or schema change

LOOP
1. Observe the reviewer skill wording, the reference doc, and conformance caps.
2. Add the smallest note, or none if present.
3. Run focused verification.
4. Stop when proven or blocked.

VERIFY
- `node --test test/skills-conformance.test.mjs` passes.
- `git diff --check` passes; `git status --short` shows at most the one allowed path changed.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: changed paths (or "no diff required"), commands with exit codes, evidence, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- required evidence cannot be produced
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

ROLE
Product Implementer

RESPONSIBILITY
Apply the Wave B reviewer findings (one authorized repair round).

STATE
Facts:
- Baseline: commit db44fa0 (W6 #116), branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Reviewer verdict: ACCEPT_WITH_FINDINGS, no blocker. Repair exactly these three; the fourth (P3 zero headroom) is advisory only — do not chase it.
  1. P2 — `apply_patch`/patch-body fail-open. `collectPaths` in `hooks/orchestrator-write-lock.cjs` scans only path-ish fields and the `command` string. Proven: `{tool_input:{patch:'*** Update File: design.md...'}}` → ALLOW, as do `{file:...}` / `{filename:...}`. Since `hooks.json` wires the `apply_patch` matcher, a pathless patch envelope carrying locked filenames in a diff/patch/content field passes through. Repair: run the existing locked-token regex over `patch`/`diff`/`content`/`text`/`edits` fields too, plus a regression test in `test/orchestrator-write-lock.test.mjs`.
  2. P3 — `handle()` drops envelope-carried role. `handle()` (~line 259) sources role only from `opts.role`/`process.env.BEARING_ROLE`, ignoring `input.role`/`BEARING_ROLE`/`assigned_role` that `evaluate()` understands (fail-closed today, but an evaluate-vs-handle contract inconsistency). Repair: fall back to envelope role fields in `handle()` before defaulting, + test.
  3. P3 — over-broad basename matching. `ownerFor` denies `workspace.md`/`design.md` at any path (e.g. `/tmp/workspace.md`) and any nested `x/docs/coe/y.md`. Repair: document the breadth in `hooks/com.anthropic.claude-code/mapping.md` (one short note). Do not change matching semantics.
- Gates: `node --test test/*.test.mjs`, `python3 test/schema-validation.py`, `git diff --check`.

OBJECTIVE
Patch-body filenames are denied, `handle()` honors envelope role fields, and the basename breadth is documented — behavior otherwise unchanged, suite green.

AUTHORITY
Allowed paths:
- hooks/orchestrator-write-lock.cjs (items 1-2 only)
- test/orchestrator-write-lock.test.mjs (regressions for items 1-2)
- hooks/com.anthropic.claude-code/mapping.md (one short note for item 3)

Prohibited: deny/allow matrix changes beyond items 1-2, skill wording, caps, schemas, any other file.

LOOP
1. Observe `collectPaths`, `handle()`, and existing tests.
2. Smallest failing regressions first.
3. Smallest allowed changes.
4. Focused verification, then full suite + schema + diff check.
5. Stop when proven or genuinely blocked.

VERIFY
- New regressions fail before / pass after (patch-body DENY; envelope role ALLOW for entitled role, DENY preserved for Orchestrator).
- `node --test test/*.test.mjs` fully green; schema holds; `git diff --check` clean.
- `git status --short` shows only the three allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: changed paths, commands with exit codes, evidence, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- required evidence cannot be produced
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

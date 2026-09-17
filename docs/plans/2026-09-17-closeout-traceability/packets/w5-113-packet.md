ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice: the #113 Orchestrator/Scribe/repair-budget hardening.

STATE
Facts:
- Baseline: commit 9a0f9e9 (W4 #112 committed). Branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite. Build on W4's wording; do not revert or duplicate it.
- Issue #113 notes a local personal override exists on the owner's machine but is uncommitted upstream: you cannot see it. Reconstruct strictly from the acceptance boxes below; do not invent extra rules.
- Current state (verified by controller; W4 may have moved some lines — confirm before changing):
  - `skills/architectural-alignment/SKILL.md:33-36` records gaps and activates Systems Modeler rather than inventing architecture, but lacks an explicit map-only handoff and no-repeat boundary.
  - `skills/scribe/SKILL.md` owns transcription; no skill states that Orchestrator transcription is forbidden or that unavailable Scribe is a capability gap rather than substitution authority.
  - One-review/one-repair bound exists (prior #62); no rule states that role/session changes or labels (reconciliation, delta, refresh) cannot renew a spent allowance — except W4's delta-mode work, which you must not contradict.
  - `owner-stops.md` D-class covers continuation; routine specialist handoffs lack an explicit continue-to-agreed-checkpoint rule.
- Related prior work #62 and #84 must be preserved, not re-litigated.
- Gates: `node --test test/*.test.mjs`, `python3 test/schema-validation.py`, `node --test test/skills-conformance.test.mjs`.

OBJECTIVE
Every #113 acceptance box holds upstream: Alignment maps and hands off without designing; completed Alignment never repeats unless source invalidates it; Orchestrator never authors specialist artifacts or transcribes history; spent allowances never renew under new labels; findings aggregate before the single authorized repair; routine handoffs run to the agreed checkpoint; contradictory wording removed; regression/forward cases added; distributions propagated without auto-reload claims.

AUTHORITY
Allowed paths:
- skills/architectural-alignment/SKILL.md (map-only handoff, no-repeat boundary)
- skills/bearing-lite/SKILL.md (ownership lines only; preserve W4's step 3)
- skills/bearing-lite/references/owner-stops.md (Scribe ownership, non-renewal, continue-to-checkpoint)
- skills/bearing-lite/references/assurance-policy.md (aggregate-before-repair only if missing)
- test/ (regression/forward cases: unchanged maps, missing architecture, renamed repairs after exhaustion, Scribe ownership, ordinary non-Lifecycle work)
- package/skill-copy distribution docs touched by W4 (propagate only, no new mechanism)

Prohibited:
- undoing or duplicating W4's lock/dispatch/delta work
- hook evaluators, schemas, packet dispatch logic
- new review/repair rounds or budget increases (this is a follow-up on loopholes, not more rounds)
- issue #92 scope, unrelated cleanup

LOOP
1. Observe current (post-W4) wording; map each acceptance box to satisfied-cite or missing.
2. Smallest failing regression first for each missing behavior.
3. Smallest allowed changes.
4. Focused verification, then full suite + conformance + schema + diff check.
5. Stop when proven or genuinely blocked.

VERIFY
- New regression/forward cases fail before / pass after.
- `node --test test/*.test.mjs` fully green; conformance green; schema 268/0 pattern holds; `git diff --check` clean.
- `git status --short` shows changes only inside allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: per-box verdict table, changed paths, commands with exit codes, evidence, remaining risks, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

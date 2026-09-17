ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice: the #116 bounded Reviewer → Repair Implementer transition.

STATE
Facts:
- Baseline: commit 8be201b (W5 #113 committed). Branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Owner decision (final): ALLOW the bounded same-session transition, owner-gated by the limits below.
- Current state: `skills/reviewer/SKILL.md:44` says "Never implement a finding"; verdicts at lines 48-53 (`REPAIR_REQUIRED` etc.). The one-repair budget lives in `skills/bearing-lite/SKILL.md:35-37` (`max_assurance_rounds` 1, one review authorizes one repair, deterministic closure without another review) — preserve it, do not expand it.
- Transition design (approved, implement exactly this):
  1. While holding Reviewer authority the agent MUST NOT edit the candidate. It first completes and freezes a review receipt: candidate ref/revision/digest, verdict, finding IDs, severity, precise locations, reachability/impact evidence, reproducer or failing command, requirement/SEIT/contract refs, bounded repair target, permitted repair write set. Receipt persisted before any mutation.
  2. Only after the parent controller accepts `REPAIR_REQUIRED` may the same agent transition to Repair Implementer authority, explicitly and recorded — never represented as the Reviewer editing code. Repair limited to frozen findings, approved write set, existing one-repair budget, same candidate lineage/worktree/branch/generation, existing stops. No refactoring, scope expansion, or owner-only decisions.
  3. Preserve loaded context; hosts that cannot preserve the session safely fall back to explicit repair dispatch rather than weakening checks.
  4. No self-certification: bounded repair closes by the existing deterministic-verification contract; no additional general review round for the same unit; failed repair, scope expansion, or new design issues return to Owner Authority.
  5. One repair round remains the limit; new defects outside frozen findings follow existing stop/escalation rules.
- Gates: `node --test test/*.test.mjs`, `python3 test/schema-validation.py`, `node --test test/skills-conformance.test.mjs` (reviewer 60-line/600-word caps must hold).

OBJECTIVE
The transition exists as an explicit, typed, budgeted authority change with frozen receipt, lineage limits, deterministic closure, and dispatch fallback — and the standing one-repair/no-rereview budget is unchanged.

AUTHORITY
Allowed paths:
- skills/reviewer/SKILL.md (transition section; caps must hold)
- skills/bearing-lite/references/review-policy.md (transition + budget interplay, if that file owns it — confirm)
- skills/implementer/SKILL.md (repair-packet receipt fields, only if the bounded-repair input shape lives there)
- test/ (transition contract tests: frozen-receipt-required-before-mutation, write-set/lineage limits, no-self-certification, one-repair limit, fallback)

Prohibited:
- expanding repair rounds, adding review rounds, weakening Reviewer independence
- W4/W5 lock, dispatch, and ownership wording (build on it, do not relitigate)
- hook evaluators, schemas, harness runtimes, issue #92 scope, unrelated cleanup

LOOP
1. Observe the reviewer skill, repair-budget references, and existing tests.
2. Smallest failing regression first for each transition rule.
3. Smallest allowed changes.
4. Focused verification, then full suite + conformance + schema + diff check.
5. Stop when proven or genuinely blocked.

VERIFY
- New transition tests fail before / pass after.
- Full suite green; conformance green (reviewer caps intact); schema holds; `git diff --check` clean.
- `git status --short` shows changes only inside allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: per-rule verdict table (items 1-5 above), changed paths, commands with exit codes, evidence, remaining risks, blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

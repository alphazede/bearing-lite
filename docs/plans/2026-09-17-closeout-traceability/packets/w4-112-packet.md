ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice: the #112 Orchestrator role-boundary enforcement (plus the issue-comment item 7 delta packet).

STATE
Facts:
- Baseline: commit 1344d67 (Wave A repair), branch main, repo /home/spectre/alphazede/Alphazedehq/bearing-lite.
- Owner decisions (final): full mechanical lock plus wording (docs-only rejected as already-failed); documented fallback acceptable on hosts without a pre-write hook.
- Current state (verified by controller, verify yourself before changing):
  - No `BEARING_ROLE` mechanism exists; only Test Engineer `write_set` in `hooks/te-host.cjs`.
  - `hooks/hooks.json` wires PreToolUse (matcher `Write|Edit|MultiEdit|NotebookEdit|apply_patch|Bash`) to `hooks/te-host.cjs`; `hooks/com.cursor/hooks.json` wires `preToolUse`/`beforeShellExecution` to `te-host.cjs --host=cursor`.
  - `skills/bearing-lite/SKILL.md` step 3 says "Run Intake → Architectural Alignment → Scope Definition; ... Invoke Planning and Design once settled" (read as do-it-yourself, not dispatch).
  - Stage skill openers today: `planning-and-design`: "Fresh planning node. The Orchestrator writes Lifecycle state and owns conversation."; `intake`: "Fresh planning node. It returns evidence; the Orchestrator records the decision."; `architectural-alignment`: "Fresh planning node. The Orchestrator announces ...". Check `scope-definition` yourself.
  - `skills/requirements-engineer/SKILL.md:51-52`: "Rerun the gate on each corrected register within Planning and Design's correction rounds."
  - `test/hook-contract.test.mjs` holds a closed module list (open to the two TE files, closed to everything else) — a new lock module must be admitted there explicitly.
  - Activation receipt logic lives near `hooks/activation.cjs` (confirm yourself).
- Protected Orchestrator-denied paths (from the issue): `*-technical-plan.md`, `design.md`, `workspace.md`, `seit.json`, `implementation.json`, `*-dod-manifest.html`, `repository-map.md`, and requirement-library roots; Orchestrator may write only `journey.json`, `journey.md`, `authority.json`, `evidence/packets/**`. Refusal text names the owning role and the dispatch command.
- Item 7 (issue comment): backward-flowing specialist findings need a planning delta packet dispatched to a Planning and Design session (`BEARING_ROLE=planning_and_design`), with a `delta mode` in `planning-and-design/SKILL.md` (apply named findings, re-embed digests, return `DELTA_APPLIED`); the write-set lock forces this path.
- Existing gates: `node --test test/*.test.mjs` (508 pass), `python3 test/schema-validation.py` (268/0), `node --test test/skills-conformance.test.mjs` (caps on reviewer skill; check whether other skills have caps before editing openers).

OBJECTIVE
An Orchestrator session attempting a planning/library write is refused with owning-role guidance; stage skills run as dispatched sessions with receipts; a third planning correction round needs the owner's word; the skill-copy install carries the lock or reports `write_lock: absent`; delta findings flow through Planning and Design, never Orchestrator edits. Proven by negative tests.

AUTHORITY
Allowed paths:
- hooks/ (new `orchestrator-write-lock.cjs` pure evaluator + `hooks.json` + `com.cursor/hooks.json` wiring; per-harness fallback docs e.g. `hooks/com.anthropic.claude-code/mapping.md`)
- skills/bearing-lite/SKILL.md (step 3 dispatch reword)
- skills/intake/SKILL.md, skills/architectural-alignment/SKILL.md, skills/scope-definition/SKILL.md, skills/planning-and-design/SKILL.md (dispatch openers + delta mode)
- skills/requirements-engineer/SKILL.md (gate amendment)
- skills/bearing-lite/references/owner-stops.md (correction-round row)
- skills/bearing-lite/references/resume.md (router-precedent note)
- skill-copy install path + activation receipt (discover: activation.cjs and onboarding/skill-copy docs)
- test/ (negative tests + hook-contract module-list admission + conformance updates if caps affected)

Prohibited:
- hook evaluator semantics from Waves A (review-capability, verification, profiles freeze)
- role skills beyond those listed, live user profiles, harness runtimes
- issue #92 scope, unrelated cleanup

LOOP
1. Observe the cited files; confirm each pointer above.
2. Write the smallest failing regression first: Orchestrator session (no `BEARING_ROLE`) denied on `design.md`; `BEARING_ROLE=planning_and_design` allowed.
3. Make the smallest allowed changes, hook evaluator first, then wiring, then wording.
4. Run focused verification, then full suite + conformance + schema + diff check.
5. Stop when proven or genuinely blocked.

VERIFY
- Negative test fails before / passes after; positive role test passes.
- `node --test test/*.test.mjs` fully green; `test/skills-conformance.test.mjs` green (caps intact).
- `python3 test/schema-validation.py` passes; `git diff --check` passes.
- `git status --short` shows changes only inside allowed paths.

RETURN
Outcome (one): PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, OWNER_DECISION_REQUIRED.
Include: per-item verdict table (the six issue items + comment item 7), changed paths, commands with exit codes, evidence, remaining risks (hosts without pre-write deny), blocker if any.

STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
Do not stop merely because the work is difficult. Do not commit, push, or open issues; the controller commits.

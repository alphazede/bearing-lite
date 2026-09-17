## Goal

Close out bearing-lite issues #111, #112, #113, #114, #116, #117 (everything except #92) with a traceable record of what is already done versus what remains, then implement the remainder in coherent waves with per-issue commits.

## Success Criteria

- Every acceptance box of the six issues is traced to done, partial, or todo, with file and commit evidence.
- All todo boxes are implemented, with per-issue local commits and the focused validation in Validation Plan passing.
- No behavior for #92 scope (per-harness install testing) is claimed; its folded-in host-readiness item is recorded as excluded.
- No push, merge, release, or issue-close happens without a separate explicit ask.

## Context And Current Facts

Branch `main`, clean apart from untracked `.agents/memory/`. Head commits after the 1.0.3 baseline (`1ddd83b`) are `a4104a8` (freeze fix, refs #114) and `254c60b` (reviewer OCR naming, #117). Baseline just re-verified: `node --test test/profile-capability-freeze.test.mjs test/skills-conformance.test.mjs` gives 42 pass, 0 fail.

Traceability (done / partial / todo per issue):

- #111 (`required` is a no-op when `enabled`): TODO upstream. `hooks/review-capability.cjs:80` still ORs (`!enabled && !required`); `hooks/verification.cjs:183` still `selected || required`; schema `schemas/profiles.schema.json:364` requires only `enabled`. No distinguishing test exists.
- #112 (Orchestrator boundary): TODO. No `BEARING_ROLE` mechanism, no Orchestrator write-set lock (only Test Engineer `write_set` in `hooks/te-host.cjs`), `skills/bearing-lite/SKILL.md` step 3 still says "Run Intake → …" rather than dispatch-fresh-sessions, no planning-delta packet, no skill-copy hook. The issue comment adds a 7th item (delta packet + `planning-and-design` delta mode).
- #113 (Orchestrator/Scribe/repair budgets): TODO upstream. No `scribe` mention in `skills/bearing-lite/SKILL.md` or `references/owner-stops.md`; the issue itself notes the hardening exists only as a local personal override, uncommitted.
- #114 (freeze/dispatch preservation): PARTIAL. Freeze slice done in `a4104a8` (`hooks/profiles.cjs:228-233` copies `review` and `deterministic_verification` into snapshot and digest material; `test/profile-capability-freeze.test.mjs`, 302 lines). Remaining: frozen-snapshot → Reviewer packet projection, reconciliation path for old roles-only snapshots, drift/unavailable/propagation regressions, planning-vs-implementation budget wording, reconciling the affected local lifecycle. The commit message explicitly scopes those out.
- #116 (Reviewer → Repair Implementer transition): TODO and gated on an owner contract decision. `skills/reviewer/SKILL.md:44` still says "Never implement a finding."
- #117 (Reviewer names OCR): PARTIAL. Naming done in `254c60b` (`skills/reviewer/SKILL.md:40`: "OpenCodeReview (OCR) is one"); conformance passes (see baseline above). Remaining: owner confirms the backend name belongs in the role skill rather than packet-plus-reference only; per-harness host readiness is owner-machine config and folds into #92, excluded here.

Correction to "most of it has been done": two slices are done (freeze helper, OCR naming); four issues are untouched upstream and #114/#117 each retain owner-facing remainders.

## Constraints And Non-goals

- #92 (per-harness install/matrix testing) is out of scope; #117 host-readiness verification goes there if wanted.
- One local commit per issue at publish time; shared wave gates but issue-to-diff and issue-to-test mapping preserved.
- No silent live-profile hot reload; old roles-only snapshots get an explicit amendment path (#114).
- Activated-but-unavailable stays a typed gap; this plan changes what `required` additionally enforces, never the gap behavior (#111).

## Key Decisions

1. #111 direction: give `required` force (recommended) vs drop it. Recommended: `required` means the role may not proceed without the capability (halt), `enabled` means proceed with a recorded note; both stay typed gaps when unavailable. Keeps existing profiles meaningful; removal would need migration for identical expressiveness. Rejected alternative (single boolean) is smaller but discards a distinction profiles already carry.
2. #116 transition: allow bounded same-session transition (recommended, owner-gated) vs keep strict re-dispatch. Recommended: allow after frozen review receipt is persisted and the controller accepts `REPAIR_REQUIRED`, limited to frozen findings, approved write set, existing one-repair budget, same candidate lineage; repair closes by deterministic verification, never self-certified; hosts that cannot preserve session safely fall back to dispatch. Rejected strict-only alternative preserves independence more simply but pays full context-reload cost on every repair.
3. #117 naming placement: keep the OCR name in the role skill (recommended, owner to confirm) vs packet-plus-reference only. The committed wording keeps declared-never-discovered intact and fixes the discoverability defect; moving it back reopens the original complaint.
4. #112 scope: full mechanical lock plus wording (recommended) vs docs-only. Docs alone already failed once (#112 evidence); the hook plus `BEARING_ROLE` dispatch plus delta packet is the structural fix. Hosts without a pre-write hook get a documented fallback, not silent absence.

## Recommended Approach

Settle the three owner decisions first (direction of #111, allow #116, confirm #117 placement), then run two waves: Wave A (capability contract: #111, #114 remainder, #117 confirmation) and Wave B (authority boundaries: #112, #113, #116 if approved). Wave A first because #114 dispatch projection consumes the #111 semantics.

## Work Plan

- W0. Owner decisions: #111 force-vs-drop, #116 allow-vs-strict, #117 keep-vs-move, #112 host-fallback acceptability. Blocks W1/W2 direction.
- W1. #111: implement distinct `required` semantics in `hooks/review-capability.cjs` and `hooks/verification.cjs`, update schema descriptions and `references/review-capability.md`, add distinguishing tests (diverge the currently identical table rows), handle legacy profiles explicitly.
- W2. #114 remainder: project frozen `snapshot.review` / `snapshot.deterministic_verification` into Reviewer/assurance packets; add amendment path for roles-only snapshots; add drift/unavailable/propagation regressions; fix planning-vs-implementation budget wording; reconcile the affected local lifecycle without replaying author realization or granting extra rounds.
- W3. #117 confirmation: owner-confirmed keep-or-move of the OCR name; doc-only diff either way; record host-readiness handoff to #92.
- W4. #112: Orchestrator write-set lock hook plus per-harness wiring and fallback docs; `BEARING_ROLE` session dispatch on every harness; reword `skills/bearing-lite/SKILL.md` step 3 and add "dispatch this" openers to stage skills; owner-stops correction-round row plus Requirements Engineer amendment; skill-copy install writes the hook or records `write_lock: absent`; planning-delta packet and `planning-and-design` delta mode (comment item 7); negative tests (denied vs allowed writes).
- W5. #113: Orchestrator/Scribe ownership wording, Alignment map-only no-repeat boundary, non-renewable allowance rule, single aggregated repair preservation, continue-to-checkpoint rule; regression/forward cases listed in its acceptance; propagate through package/skill-copy distributions.
- W6. #116 (only if W0 approves): frozen-receipt fields, explicit transition record, write-set/lineage limits, no-self-certification closure, one-repair limit, fallback to dispatch; skill and reference edits plus tests.

## Validation Plan

- Wave A: `node --test test/*.test.mjs` (full suite; `a4104a8` baseline was 499 pass); `python3 test/schema-validation.py`; new #111 tests must show the previously identical enabled/required rows diverging; new #114 regressions for omitted sections, live drift, selected-but-unavailable, packet propagation.
- Wave B: negative hook test (no `BEARING_ROLE` writing `design.md` refused; `BEARING_ROLE=planning_and_design` succeeds); `node --test test/skills-conformance.test.mjs` (reviewer 60-line/600-word caps); #113 forward cases (unchanged maps, missing architecture, renamed repair after exhaustion, Scribe ownership, non-Lifecycle work).
- Both waves: `git diff --check`; `npm pack --dry-run` identity/count check; highest-risk step is the #111 semantics change, since existing profiles carrying `required` change enforcement meaning.

## Risks / Rollback

- `required`-with-force changes enforcement for existing profiles: mitigate with explicit legacy handling and release-notes entry; rollback is revert of the W1 commit.
- Hook coverage is uneven across harnesses (only hosts with native pre-write deny enforce mechanically): mitigate with documented fallback and activation-receipt reporting; never claim enforcement where the host lacks it.
- #116 transition risks self-certification drift: mitigate with frozen receipt before mutation and deterministic-verification closure; rollback is fallback to strict dispatch.
- Scope creep into #92 harness testing: guarded by the non-goals above.

## Open Questions

- O1: #111 — give `required` force (recommended) or drop it? Decided: give `required` force.
- O2: #116 — allow the bounded same-session transition (recommended) or keep strict re-dispatch? Decided: allow, owner-gated per W6 limits.
- O3: #117 — keep the OCR name in the role skill (recommended) or move it to packet-plus-reference only? Decided: keep.
- O4: #112 — is a documented fallback acceptable on hosts without a pre-write hook, or must those hosts stay unsupported for Lifecycles? Decided: yes, documented fallback is acceptable.

## Staffing (Role To Task Mapping)

No Lifecycle, no Orchestrator. This session acts as the parent controller on direct packets; each unit gets a bounded role packet with its own write set and return receipt. The Implementer skill expects a Lifecycle snapshot and lease; without a Lifecycle the packet carries the baseline commit, exact write set, acceptance rows, and stop rule instead.

| Task | Role | Route | Why |
|---|---|---|---|
| W1 #111 hook semantics + schema + reference + distinguishing tests | Implementer | cursor-agent, grok 4.6 medium | Judgement work across product code and contract docs; failing regression first |
| W2 #114 packet projection + amendment path + regressions + wording | Implementer | cursor-agent, grok 4.6 medium | Same contract surface as W1; continue the session if authority is unchanged, commit per issue |
| W3 #117 keep-or-move confirmation | Light Implementer | cursor-agent, grok 4.6 medium | Doc-only mechanical slice either way |
| W4 #112 write-set lock + `BEARING_ROLE` dispatch + wording + delta mode + negative tests | Implementer | cursor-agent, grok 4.6 medium | Largest packet; may split into two packets (code, wording) in one continued session |
| W5 #113 ownership/boundary wording + forward cases | Implementer | cursor-agent, grok 4.6 medium | Same session continuation candidate as W4, separate commit |
| W6 #116 transition contract + tests | Implementer | cursor-agent, grok 4.6 medium | Owner-approved per W0; contract wording, no product runtime |
| Gate after Wave A (W1–W3) | Reviewer | subagent | One integrated defect review per wave, not per issue |
| Gate after Wave B (W4–W6) | Reviewer | subagent | Same; `REPAIR_REQUIRED` routes a bounded repair packet to Implementer |
| Final system check | Integration Engineer | subagent | Full suite + schema validation + pack identity as execution assessment |
| Not staffed | Orchestrator, Coordinator, Scribe, planning roles, Test Implementer split | — | No Lifecycle to sequence; direct packets with a W1→W2 dependency; plan already approved; single-author packets |

Test Engineer assurance is optional: the deterministic suites plus per-wave Reviewer cover these hook/doc changes. Staff a Test Engineer pass only if independent V&V of the W4 enforcement hook is wanted.

## Closeout (2026-09-17)

- Wave A: 10ea397 (#111), 27072cb (#114), bc9ef20 (#117), 1344d67 (repair). Reviewer gate ACCEPT_WITH_FINDINGS (3 doc findings, repaired).
- Wave B: 9a0f9e9 (#112), 8be201b (#113), db44fa0 (#116), 12fdc03 (repair). Reviewer gate ACCEPT_WITH_FINDINGS (P2 fail-open + 2 P3, repaired; P3 headroom advisory).
- Controller interventions: took over stalled W4 run (3 wording regressions fixed); restored dropped Coordinator clause in W5; completed file/filename path keys in Wave B repair; router word cap 400→425→435 with recorded justification (mandated content cannot fit 400 without gutting pinned lease mechanics).
- Integration Engineer final check: READY at 12fdc03. node 530/530, schema 268/0, diff-check clean, pack @alphazede/bearing-lite@1.0.3 73 files, audit clean for package closure.
- Residuals (owner-side): #92 excluded; desktop lifecycle roles-only reconciliation; per-harness BEARING_ROLE beyond Claude/Cursor procedural.
- Pending explicit owner ask (not done): push, GitHub issue closeout comments/closes, release.

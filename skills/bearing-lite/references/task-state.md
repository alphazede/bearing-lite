# Task state (authoritative text)

The project's human-readable plan is the only task-state record. Diagrams explain; they never authorize a transition, create state, or grant authority.

## States and active owners

| State | Active owner | Meaning |
| --- | --- | --- |
| `PROPOSED` | Parent controller | Task exists but is not execution-ready |
| `READY` | Parent controller | Dependencies, scope, authority, and route are satisfied |
| `WAITING_ON` | Parent controller | Named prerequisite, checkout-lease conflict, or independent-assurance dispatch unavailable |
| `IN_PROGRESS` | Assigned worker or parent controller | Assigned action is being performed |
| `EVIDENCE_READY` | Parent controller | Candidate and evidence ready for next missing assurance |
| `VALIDATING` | Assurance Test Engineer | Evidence sufficiency under validation |
| `REVIEWING` | Reviewer when required | Independent defect review active |
| `ACCEPTANCE` | Integration Engineer execution, Owner Authority, or parent controller when `required_assurance` is `none` | User-facing acceptance or parent-controller completion confirmation is active |
| `CORRECTION_REQUIRED` | Orchestrator or nearest parent controller | Agent-owned in-authority correction required |
| `OWNER_DECISION_REQUIRED` | Owner Authority | Authority, scope, security, or replacement-path judgment required |
| `COMPLETE` | Parent controller after assurance | Outcome and required assurance satisfied |
| `CANCELLED` | Owner Authority or authorized parent | Task will not proceed |

## Legal transitions

- `PROPOSED` → `READY` when dependencies, scope, authority, assigned role, and assurance are declared and satisfied; else `WAITING_ON`.
- `WAITING_ON` → `READY` when the prerequisite is repaired or replaced; → `EVIDENCE_READY` when fresh assurance becomes available; → `CANCELLED` on owner scope reduction.
- `READY` → `IN_PROGRESS` when the assigned role starts; → `OWNER_DECISION_REQUIRED` on authority or integrity guard.
- `IN_PROGRESS` → `EVIDENCE_READY` with candidate and handoff; → `CORRECTION_REQUIRED` on correctable failure; → `OWNER_DECISION_REQUIRED` on security, authority, or integrity guard.
- `CORRECTION_REQUIRED` → `READY` with a new hypothesis and evidence inside the recorded authority and any owner-supplied allowance; → `OWNER_DECISION_REQUIRED` when that allowance is exhausted or an out-of-contract amendment is needed.
- `EVIDENCE_READY` → `VALIDATING` | `REVIEWING` | `ACCEPTANCE` for the next missing required role; → `WAITING_ON` if assurance dispatch is unavailable.
- During the single assurance round, an accepted Assurance Test Engineer or Reviewer handoff returns to `EVIDENCE_READY` to select the next missing assurance role in declared order.
- `VALIDATING` → `CORRECTION_REQUIRED` when more evidence or repair is needed; otherwise back through `EVIDENCE_READY` for remaining assurance.
- `REVIEWING` → `CORRECTION_REQUIRED` | `EVIDENCE_READY` | `OWNER_DECISION_REQUIRED` by verdict.
- `ACCEPTANCE` → `COMPLETE` when every required assurance accepted the same candidate; when `required_assurance` is `none`, parent-controller confirmation satisfies the assurance requirement; → `CORRECTION_REQUIRED` on acceptance gap.
- `OWNER_DECISION_REQUIRED` → `READY` or `CANCELLED` by owner choice.

## Ownership rules

- One parent controller writes each task block and its transitions. The parent controller is the Orchestrator on a direct packet or new wave. On a frozen legacy coordinator wave, the Coordinator retains ownership on its pinned runtime until explicit handover.
- Orchestrator alone writes cross-wave dependencies and Lifecycle-wide sequencing.
  Start every ready slice whose declared `inputs` and dependencies are met and
  whose held `resource` and `write_set` are free across the frozen graph.
  Run the first implementation slice as a preflight slice with every planned
  command in dry-run or `--version` form on every target host in parallel, and
  end any phase that builds a host by running that repository's real gate on it.
- Direct packets never dispatch Coordinator. New waves also use the Implementation Orchestrator regardless of legacy catalog entries. A frozen legacy assignment without its pinned runtime or explicit handover is a typed capability gap.
- Workers and assurance roles return handoffs; they do not race plan edits.
- Candidate authors never provide their own Assurance Test Engineer, Reviewer, or Integration Engineer execution verdict. Implementer must not self-certify.
- Waiting on a prerequisite consumes no correction attempt. Record corrections as evidence, not a fixed attempt cap. Preserve any owner-supplied allowance; identical retries without new evidence are invalid.
- Each declared phase or wave receives at most one assurance round and one review-directed repair. Replacement candidates do not reset the count within that declared unit. The next distinct phase or wave carries its own 1/1 budget. The parent controller records `assurance_rounds`, preauthorizes bounded same-session repair in the review packet, and records deterministic closure from the repaired candidate’s evidence without dispatching assurance again.
- Independent assurance on a multi-slice unit may start on finished slices'
  immutable receipts and the pinned candidate while the last slice runs.
  The same session joins the last slice's receipts before issuing its verdict
  on the final integrated candidate. Apply the [dispatch timing](assurance-policy.md#dispatch-timing-222)
  and keep single-run role and gate budgets.
- `COMPLETE` is terminal for Bearing assurance. An already authorized deployment keeps operational verification and rollback readiness but does not reopen review; candidate-changing deployment work requires separate scope.

## Landing a closed unit

The parent controller lands the unit before reporting it `READY` or
`COMPLETE`. A unit is not landed while its requested review is pending.
Landing uses the existing review round without opening another.

1. Finish the change and its focused checks.
2. Push the Lifecycle branch and open or update one
   pull request to the default branch as a draft to get its number.
3. Commit the `CHANGELOG` link and any PR-number-dependent text on the leased
   Lifecycle branch.
4. Gate once on that final commit. Run the unit's exit commands after that last commit
   and push the verified commit to update the draft PR. If a push runs the
   repository gate, push the final commit and reuse the result for the unchanged
   head when its input hashes match. If review and landing share this repository
   gate, supply the same exact-head gate result to the review.
5. When the requested review round and required checks pass, confirm the
   draft PR head matches the exact-head merge receipt. Mark the PR ready and
   merge that head under the existing authority.

A head change after gating is a procedure defect. The exact-head merge receipt
still applies, and the landing has one repository gate run.

- **Commit.** Revalidate the wave receipt at `commit` and commit on the leased
  Lifecycle branch. Never commit on the default
  branch. Keep raw logs out of commits.
- **Pull request.** Name the unit, candidate revision,
  deterministic and review receipts, and the issues it addresses. Planning
  proposes `commit`, `push`, and `open_pull_request` in the authority
  envelope's `allowed.actions`, and the integrated approval grants them.
  Without them, or with them in `prohibited.actions`, return
  `OWNER_DECISION_REQUIRED` (owner-stops class F). A missing remote or a
  refused push is `WAITING_ON`, never a landed unit.
- **Merge:** merge only when `allowed.actions` includes `merge` for that unit
  and the repository's required checks pass on the exact-head pull request
  commit (the merge guard's exact-head receipt requirement is unchanged). When a
  change edits a table or fixture that other suites read, run the heavy check
  before merge rather than merging on a fast gate that skips those suites. A
  passing check, a review verdict, or a profile setting never grants merge.
  Otherwise merge stays with the owner: report the pull request, mark the unit
  as awaiting the owner's merge, and continue dependency-ready work on the
  same branch. Never rewrite published history to land. When a target-host gate
  cannot run, land locally only what the plan and `handoff.md` explicitly permit
  while holding host-gated closure or merge.
- **Record:** each push, pull request, and observed merge is a landing. The
  configured recorder transcribes it before handoff or closeout.
  `hooks/reconcile.cjs` observes merges through `merge` events. It never
  performs them.
- **Closeout lesson:** apply `reflect-correct.md` when the unit lands. A test
  or documentation lesson edits through normal review. A new guard or hook
  goes to the owner.

## Orchestrator context

Keep this context on coordination, owner decisions, dispatch and synthesis.
There is no context-size ceiling that forces a handoff.

A background event that changes no decision gets no reply. Consume completion
events that unlock dependencies as they arrive. For a specialist return, use
the author's deterministic checker, compare the candidate digest, and report
one line; evidence returns digests, commands, and exit codes, not narrative logs.
Planning specialists run only their own artifact checker while the repository
gate runs once at assembly. Every packet carries a time target and "at the limit,
return what you have and list the gaps". Before composing a packet, follow `pre-packet.md`: use the handoff compiler
(`tools/compile-handoff.mjs`) for execution packets (once `implementation.json`
and `seit.json` exist) instead of writing the packet by hand, and use the
Prompt template (`../../prompt/SKILL.md`) for planning (pre-assembly) packets. Side work runs outside this context on an
approved lighter model where that model is adequate. Waiting and dispatch use
the owner-selected route in `profiles.md` and do not lower its reasoning effort.
ketchup-video and automate-me stay optional skills outside Bearing core. They
never change a frozen profile. How, Why and Benchmark Checklist stay optional
and are not forced into every task.

## Checkout lease

The Orchestrator inventories visible nonterminal Lifecycles and holds one
generation-bound checkout lease before any planning write or dispatch.

- Same checkout plus a live other Lifecycle → `WAITING_ON` with sanitized
  competing Lifecycle and controller. Distinct explicitly approved compatible
  worktrees may proceed.
- Resume keeps the same generation and must not duplicate dispatch.
- `COMPLETE` or `CANCELLED` releases the lease exactly once.
- Stale recovery is explicit, recorded, increments generation, and cannot
  steal a live lease. Forged or stale-generation records fail closed.
- Branch or HEAD drift from the leased identity stops the transition before
  mutation. Authorized same-Lifecycle candidate progress whose parent is the
  current leased revision refreshes `candidate_revision` on the same
  generation. Foreign controller, branch/worktree, or unrelated HEAD still
  fail closed as `WAITING_ON`.

## Planning stage order

Planning runs Intake → combined Architectural Alignment and Scope (in the
Orchestrator controller session, reusing the previous `repository-map.md` after a
freshness check; the legacy Scope Definition name forwards to it
and never starts another stage) → the enabled specialists the task and chosen
process tier (`light` — Orchestrator plus one author — `standard`, or `full`)
need, in data-dependency order: MBSE → Integration and Test → the Planning
Orchestrator's own final Planning and Design and assembly (where the repository
gate runs once) → requested planning
review → owner confirmation → `handoff.md`. Independent ready work runs in
parallel; inactive roles are skipped. MBSE completes its own quality pass and
modeling from confirmed Alignment/Scope context and returns a placement receipt
that final Planning and Design allocates against (see
`../../planning-and-design/references/allocation-inputs.md`); a selected or
required but unavailable MBSE route is a typed capability gap, never silent
allocation. Integration and Test binds SEIT cases to existing requirement IDs,
and final assembly blocks until every pending binding is complete.


## Bound assurance launch accounting

For executable bound assurance, the parent uses the root plan's
`assurance_dispatch` binding and the same visible JSON task record described
in [assurance-policy.md](assurance-policy.md#mandatory-bound-dispatch-209--210).
The human-readable plan remains the authority for task transitions; the JSON
record is its visible assurance accounting projection, never a hidden task
controller. Only the pre-dispatch barrier reserves launches; parent result
updates preserve reservations, original expenditure and append-only amendments.
A missing/invalid projection denies a bound launch. A resumed session uses the
same record and declaration. A repair or transport failure never resets it.

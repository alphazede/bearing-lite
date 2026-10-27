# Recorded Repair Implementer transition

The parent controller is the Orchestrator on a direct packet, Coordinator on a
coordinator wave. Prefer advance authorization in the original requested review
packet: the same reviewer context may validate findings, freeze its receipt,
transition to Repair Implementer, fix the consolidated in-scope findings and run
deterministic checks without a controller round-trip. While reviewing it remains
read-only. Finish OCR and all declared review inputs before the first repair.
Selected repair routes/holds and independent acceptance still apply; an incompatible
route is a typed authority gap, never a silent model substitution.

## Advance authorization

The parent records `repair_transition` in `.bearing-round.lock` before dispatch.
Only the parent may write this control record; Reviewer cannot grant itself scope.
Keep `candidate` and integer `generation` on the round record. The transition carries:

| Field | Required value |
| --- | --- |
| `authorization` | `advance` |
| `accepted_by` | `orchestrator` or `coordinator` |
| `parent_accepted` | `IN_SCOPE_REPAIR`, an advance grant, not a claimed finding verdict |
| `repairs_max` | `1`; preserve already spent allowance |
| `write_set` | Exact parent-authorized repair paths, including allocated regression tests |
| `reviewer_context` | Same native host agent/session identity used for review |
| `receipt_path` | Assigned checkout-local findings receipt, persisted before repair |
| `candidate_ref`, `candidate_revision`, `candidate_digest` | Original stable candidate |
| `worktree`, `branch`, `generation` | Bound checkout, branch and current generation |
| `repair_round` | `open`; parent closes it after deterministic closure |

The Reviewer freezes a JSON receipt with matching candidate identity and `lineage`
(`worktree`, `branch`, `generation`), `verdict: "REPAIR_REQUIRED"`, nonempty
`finding_ids`, severity, locations, reachability, reproducer, SEIT refs, repair target
and exact `write_set`. The receipt's write set must be a subset of the advance grant.
The first allowed planning-artifact write atomically pins `receipt_sha256` in the
existing round record; later edits to the receipt invalidate the transition.
A competing record change or unavailable atomic lock is a typed gap; do not retry
without resolving that state. No second ledger or persistent process is introduced.
Product paths remain governed by the packet's ordinary write-set contract; this hook
continues enforcing planning-artifact ownership, not a new general filesystem sandbox.

For bound implementation dispatch, the single review slot declares `inline_repair: true`.
The existing dispatch hook reserves one repair allowance along with the review before
launch, even if no repair proves necessary. Reservation is not an actual repair or PASS;
report actual repairs separately and never refund the reserved allowance. The slot
must be the only reviewer in its group; a split review must aggregate all independent
returns before a separately authorized repair. Never repair while another reviewer
is still inspecting that candidate. If an amended inline launch overlaps another
opened group with unfinished or missing review members, the dispatch hook advises
without denying the launch. Continue review and OCR read-only; the parent schedules
repair only after every declared review finishes and the results are aggregated.
An allowed launch or absent advisory does not authorize early mutation. Planning
retains its separate 1/1 budget and records the advance allowance in its review
packet, without an implementation slot.

## Legacy transition and closure

Existing packets without advance authorization remain unchanged: after accepting
`REPAIR_REQUIRED` the parent records the same fields, including the already frozen
`receipt_sha256`, without `authorization`, `repairs_max` or advance `write_set`.
That is the legacy parent-accepted route, not an automatic grant to old live sessions.
Do not migrate an in-progress binding without explicit authority.

`hooks/orchestrator-write-lock.cjs` rereads the control record and receipt on every
protected write, checks original identity, current worktree/branch/generation,
same reviewer context, open round, digest and write set. Symlinked, escaped,
unlisted, stale, mismatched or closed writes remain refused. Role names and tool
input grant nothing. The Reviewer never edits the parent control record.

After one aggregated repair, run the packet's deterministic checks on the repaired
candidate. Return original and repaired identities, frozen findings, red/green proof,
actual repairs and verification results. The parent consumes the candidate-bound
results and records counters/closure without reproducing findings or rerunning
applicable checks. Fixable findings never become residual-risk acceptance.
Failed repair, scope growth, protected actions or exhausted authority require an
owner decision; do not dispatch another review or reset budgets.

## Late findings in an existing legacy open round

Keep the repair round open through final deterministic verification. For a new
finding, freeze an addendum; do not silently edit the receipt. Under the legacy
route the parent may admit it into the same round only after reproducing it and
confirming approved paths, unchanged contract and protected boundaries, and
remaining recorded correction allowance. Missing allowance grants none; infer no numeric attempt cap.
The same reviewer session repairs only accepted finding IDs; require red/green regression evidence.
Baseline age alone does not justify leaving a finding open. No second review.
Close only when checks pass and no accepted fixable finding remains. Never reset
budgets or reopen a closed round without owner authority. Failed repair or exhausted allowance returns to the owner. Advance authorization
does not admit new post-freeze findings automatically: return the frozen receipt
and addendum for an explicit scope/allowance decision, preserving spent budgets.

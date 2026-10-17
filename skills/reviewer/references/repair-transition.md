# Recorded Repair Implementer transition

A Reviewer stays read-only on the candidate. After the parent controller
(Orchestrator on a direct packet, Coordinator on a coordinator wave) accepts
`REPAIR_REQUIRED`, the same reviewer context may repair as Repair Implementer
only through a transition the parent records. `hooks/orchestrator-write-lock.cjs`
checks it on every write to a planning artifact; nothing in tool input or a
role name grants it.

## Where it lives

The round record `.bearing-round.lock` at the checkout root, which the parent
already writes while a round is bound (`candidate`, `plan_dir`), plus an integer
`generation` and a `repair_transition` object. Only the Orchestrator or
Coordinator may write this file; the lock refuses it to every other role.

| Field | The lock requires |
| --- | --- |
| `candidate`, `generation` (record) | equal to the transition's `candidate_ref` and `generation` |
| `accepted_by` | `orchestrator` or `coordinator` |
| `parent_accepted` | `REPAIR_REQUIRED` |
| `reviewer_context` | the writing session's host `agent_id`, else `session_id`: the same reviewer context |
| `receipt_path`, `receipt_sha256` | a file inside the checkout whose SHA-256 matches |
| `candidate_ref`, `candidate_revision`, `candidate_digest` | equal to the frozen receipt's |
| `worktree`, `branch`, `generation` | the current checkout root, its checked-out branch, and the receipt's `lineage` |
| `repair_round` | `open`; the parent sets `closed` at deterministic closure |

The frozen receipt is the JSON the Reviewer persisted before any edit: candidate
ref/revision/digest, `verdict: "REPAIR_REQUIRED"`, nonempty `finding_ids`,
severity, locations, reachability, reproducer, SEIT refs, repair target,
`write_set`, and `lineage` (`worktree`, `branch`, `generation`). Editing it after
the parent records its digest voids the transition.

## What is allowed

With `BEARING_ROLE` `reviewer` or `repair_implementer` and a valid transition,
only planning artifacts named in the receipt's `write_set` are writable. Any
missing, unaccepted, stale, mismatched, or closed element, or an unlisted path,
is refused with the failing check named. Other roles' bound-author rules are
unchanged.

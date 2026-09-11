# Owner decisions and continuation

One integrated approval covers the approved work and its continuation grant.
Before asking, identify the unresolved decision, affected slices, evidence,
and why the current policy or authority does not answer it. Never invent an
extra role, review gate, approval checkpoint, or scope to resolve uncertainty.

| Class | Decision | Router behavior |
| --- | --- | --- |
| A | Existing policy | Apply the cited rule and record a dated execution receipt. A real policy conflict is a C boundary decision. |
| B | Approved fallback | Verify unavailability under the frozen fallback condition; activate the next eligible approved route and record evidence. Changing the lineup or fallback condition is C. |
| C | Bound, scope, or policy conflict | Ask for the smallest amendment when it blocks ready work. Never reset a spent bound. |
| D | Continue approved work | Use the effective continuation grant; never ask again while its conditions hold. Missing or expired authority is F. |
| E | Integrated plan approval | Present the package once for approval or change; execution waits for explicit approval. |
| F | Authority reserved to the owner | Ask only when the action is not already expressly authorized. Owner holds remain effective until explicitly lifted. |

A/B/D continuation requires verified authority, scope, budget, exclusions,
expiry, and owner-hold checks. Missing evidence is `NEEDS_MORE_EVIDENCE`, not
permission and not automatically an owner question. Recover discoverable
evidence first; escalate a real unresolved boundary as C or F. Fallback
activation is an execution receipt, not an authority amendment. Only the
owner changes the frozen lineup or grants authority.

## Approval and authority

Map the Route includes `authority.json.continuation` in the integrated gate:
`granted`, `owner_decision_id`, named `exclusions`, and `expires_at` (UTC or
null for event-based expiry). The surrounding envelope retains allowed and
prohibited actions/paths, role grants, approval receipt, and nonempty
`expiry_conditions`. Record explicit approval against the exact package;
the continuation decision ID must occur in `granting_owner_decisions`.
No grant is inferred from silence, a lineup selection, or passing checks.

Always exclude scope change, budget exhaustion, owner holds, and owner-only
actions from the continuation grant. A separate explicit action grant can
authorize an otherwise owner-only action; continuation cannot create it.
Revocation, supersession, expiry, or changed authority invalidates the grant.
An older envelope without continuation remains valid historical data but
provides no standing continuation grant. Do not manufacture a retroactive one.

For first approval show outcome, scope/exclusions, role responsibilities,
route, bounds, risks, open decisions and proof coverage in a concise summary.
For revisions show changed requirements, design, proof cases, slices,
lineup, authority and bounds against the last owner-reviewed package, citing
both revisions/digests. Explain invalidated approvals and unresolved decisions.
Keep the complete frozen `review.html` accessible in both cases; a diff or
freeze PASS is neither approval nor proof of semantic completeness. An
unchanged package does not need reapproval. A changed package returns to the
same gate, never an extra gate.

## Queue and continue

Keep pending questions in the existing `journey.json.open_decisions` array
as typed `record_type: owner_stop` records. Preserve stable IDs when moving
answered records to `decisions`; append owner answers to normal history.
Automatic resolutions and unsolicited owner directions remain normal dated
receipts, not fabricated questions. Required fields are defined by
`schemas/journey.schema.json` and checked by the metrics helper.

Queue nonblocking questions until wave end and present one batch with the
wave receipt. Queue nonblocking owner-only closeout actions until Journey
end. Required credentials, publication prerequisites, or other owner-only
dependencies surface immediately when they block ready work. Do not defer
safety/integrity intervention or an explicit owner stop. Each actual
presentation has a stable `round_trip_id`; questions in the same batch share
that ID and the exact same presentation timestamp.
Record `asked_at` when presented, not when drafted or queued; `answered_at`
when the owner answers. Cancellation uses `cancelled_at`, never a fabricated
answer. Times are UTC with a `Z` suffix and either whole seconds or exactly
three fractional digits (milliseconds); normalize host timestamps before
recording. Re-presenting an unanswered question keeps its ID and
original asked time; it is not another distinct question.

While waiting, walk the approved slice graph. Dispatch only READY slices
with satisfied dependencies, active authority, valid lease, available route,
and verified independence from the question and other running slices.
Disjoint writes alone do not prove independence: check shared runtime,
resources, integration order, and read/write dependencies. `parallel_safe`
is evidence to inspect, not permission. Respect host concurrency limits and
never dispatch completed or already-running work again. Keep dependent work
pending. Owner holds apply to their stated scope, including the whole Journey
when so directed; they cannot be bypassed by calling work independent.

## Deterministic checks and measurement

Before a proposed stop, run `hooks/transition-order.cjs` with
`action_kind: owner_stop_check` and `owner_stop` containing `class`,
`blocking`, `evidence_ref`, `resolution_ref`, `authority`, `checked_at`,
and `checks`. Checks are explicit booleans: `scope`, `budget`, `exclusions`,
`expiry`, `owner_hold`, plus `policy` for A or `fallback` for B. Router must
verify them against the actual frozen inputs; the helper does not authenticate
receipts or interpret arbitrary path globs or expiry prose. C/E/F need the
class, evidence reference and blocking flag; return ASK or QUEUE. A/B/D
return CONTINUE only with the grant and all required checks. This is a
procedural transition adapter, not a new registered host event, permission
grant, scheduler, or security boundary. Skills-only hosts execute the same
checklist and disclose unavailable deterministic checks.

New Journeys set `owner_wait_tracking: true` and initialize
`owner_blocked_intervals: []`. Record intervals only while no authorized ready
work can progress specifically because of unanswered owner questions. Each
interval lists their `decision_ids`, `started_at`, and nullable `ended_at`.
End the interval as soon as work can progress, even if some questions remain
unanswered. Do not treat every dependency wait, off-hours gap, or commit gap as
owner-blocked time. Never backfill unknown times. Legacy Journeys without
tracking report `unavailable`, not zero waiting.

Run `node <plugin root>/hooks/owner-stops.cjs <journey.json> <as-of-UTC>` at
wave receipts and final closeout. It validates typed records, rejects duplicate
IDs or inconsistent times, counts `decisions_asked`, distinct approval
`round_trips`, pending/queued/cancelled questions and A–F counts, and reports
`response_ms` (sum of completed response intervals), `pending_response_ms`,
`response_window_ms` (union of asked-to-answer/cancellation/as-of intervals),
and `blocked_ms` (union of the explicitly recorded fully blocked intervals).
Overlapping questions are not additive wall-clock wait. Local records only:
no telemetry or network transmission. Closeout renders these metrics and
coverage limitations; it must not claim measured savings from legacy gaps.

Operational target after settled scope: zero unnecessary stops per wave;
one integrated approval batch and one closeout batch per unchanged Journey
when closeout needs owner authority. Exceptions are recorded, never suppressed
to hit a quota. Forecast savings only from verified classified observations.

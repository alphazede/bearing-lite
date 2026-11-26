# Plannotator owner review pilot

The Plannotator pilot is opt-in and off by default. It lets the owner read and
annotate a frozen planning candidate in a local [Plannotator](https://github.com/backnotprop/plannotator)
session, then hands the owner's answer to the existing owner-decision procedure.
Without it, or with it disabled, the owner gate works as before: no browser, no
extra prompt and no Plannotator call.

## What the adapter does and does not do

`tools/plannotator-adapter.mjs`:

- checks the candidate with `hooks/plan-package.cjs draft` and refuses a stale
  digest or revision, an absent or answered owner stop, a session that does not
  match the stop, a malformed or expired continuation grant, and a requested
  planning review that has not passed;
- shows a read-only copy of the candidate's planning inputs, `seit.json`,
  `implementation.json`, the DoD visual view and a `revision-diff.md` that
  compares changed sections with the last owner-reviewed candidate;
- appends typed feedback to `<feedback_dir>/<candidate digest>/feedback.jsonl`,
  one record per line, in the format of
  [`schemas/owner-feedback.schema.json`](../../schemas/owner-feedback.schema.json);
- returns an `approve_intent` when the owner approves.

It never writes the plan package, `journey.json` or `authority.json`, and an
approve intent is not a grant. The Planning Orchestrator records the decision
through the procedure in
[owner stops](../../skills/bearing-lite/references/owner-stops.md). A later stop
is answered only under the existing continuation grant, and the intent names
that grant and its granting owner decision.

## Requirements

- Node.js 22 or later.
- Plannotator, installed and pinned by its SHA-256 under your repository's
  tool-acquisition policy. The pilot was built against 0.29.4.
- Bubblewrap (`bwrap`) on Linux. The session runs with no network except
  loopback, no capabilities, a read-only system and a read-only candidate copy.
  The namespace exposes the required binaries, the relay and system runtime files. The checkout and adjacent tools are outside it. The relay serves local evidence links from read-only copies of the files named by the verified visual projection. It presents linked bytes as plain text with scripting disabled. The relay adds a same-origin network policy and removes referrer information. Plannotator sharing, remote, AI, Inbox, history and update features are off.

If Plannotator or `bwrap` is missing, the adapter returns
`{"status":"fallback","reason":"unavailable"}` and the owner answers at the
normal gate.

## Run a review

Send one JSON request on stdin; read one JSON outcome on stdout. Progress,
including the local review address, goes to stderr.

```json
{
  "enabled": true,
  "plan_dir": "docs/plans/<plan>",
  "visual_path": "<plan>-visual.html",
  "feedback_dir": "<evidence dir>/owner-review",
  "candidate": {
    "candidate_ref": "<ref>",
    "candidate_revision": "<revision>",
    "candidate_digest": "<plan-package draft manifest digest>"
  },
  "owner_stop_id": "<pending owner_stop id>",
  "owner_session": {
    "owner_identity": "<owner>",
    "harness": "<harness>",
    "session_id": "<session id>",
    "payload": { "session_id": "<session id>" }
  },
  "last_reviewed": {
    "plan_dir": "<copy of the last owner-reviewed candidate>",
    "candidate_digest": "<digest>",
    "candidate_revision": "<revision>"
  }
}
```

```bash
node tools/plannotator-adapter.mjs < request.json
```

`feedback_dir` must be outside the plan directory. The adapter regenerates the visual view for comparison and verifies the digest and revision of a supplied previous package. Omit `last_reviewed` for
a first review; the comparison then says `no prior review`.

Over SSH, forward a local TCP port to the Unix socket named on stderr. For example, from your client run `ssh -N -L "127.0.0.1:43121:$SOCKET" "$HOST"` with the reported remote socket path and your SSH host. Open `http://127.0.0.1:43121/` in your browser.

## Outcomes

| `status` | Meaning | Exit |
|---|---|---:|
| `answer_delivered` | The owner approved; `answer` is the approve intent | 0 |
| `changes_requested` | Typed change requests were written; `feedback` is their count | 1 |
| `pending` | The owner closed the session without a decision; the stop stays open | 1 |
| `fallback` | Disabled, unavailable or disconnected; use the normal gate | 1 |
| `rejected` | A check failed; `reason` names it and nothing was recorded | 1 |

Rejection reasons: `stale_candidate`, `changed_package`, `absent_stop`,
`missing_owner_identity`, `owner_session_mismatch`, `missing_grant`,
`expired_grant`, `malformed_grant`, `planning_review_required`,
`path_outside_package`, `unmappable_annotation`, `oversized_feedback` and
`invalid_request`.

The Planning Orchestrator routes each `request_changes` record to the owning
artifact. The corrected package is a new candidate with a new digest.

## Limits

- Annotations map to a Markdown heading or an HTML `<section id>`. An
  annotation on JSON or SDoc text is rejected as `unmappable_annotation`.
- Plannotator exports no annotation times, so every record of one session
  carries the adapter's clock when the session ended.
- The adapter runs on Linux only, because isolation uses `bwrap`.

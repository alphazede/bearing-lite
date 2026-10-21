# Resume and liveness

Resume reads `journey.json`, `workspace.md`, the active role contract, and
the current task. It trusts accepted stages and confirmed decisions unless a
bounded identity or drift check fails. It never adds a watchdog daemon,
heartbeat service, global timeout, or model polling, and it never replays
accepted planning.

## Preflight

Before resuming or dispatching a fallback, Orchestrator performs one
host-native liveness check when that surface exists:

| Class | Meaning | Action |
| --- | --- | --- |
| `RUNNING` | The dispatched session or process is still active | Never duplicate |
| `COMPLETED` | Durable evidence shows the task finished | Advance only from that evidence |
| `INACTIVE` / `EXITED` | The session is gone | Resume from last durable state with an approved fallback |
| `UNKNOWN` | The host exposes no reliable status | Automatic orchestration returns `WAITING_ON`. Explicit owner-requested resume may replace the agent |

Wait/status reliability varies by host and route. Host-native status checks
are recommended when available. Missing expensive models or wrappers do not
make a route ineligible.

## History coverage

Resume runs `node <plugin root>/hooks/scribe-coverage.cjs <journey.json>` and
lists every untranscribed event it reports (owner decisions, authority
events, landings) with its id and time. `ORCHESTRATOR_REQUIRED` means the profile
omits or disables Scribe: Orchestrator records those source-backed events itself.
`SCRIBE_REQUIRED` sends only missing events to the existing Scribe session on its
frozen route; `CAPABILITY_GAP` reports an unavailable selected Scribe. Handoff
(`action_kind: "scribe_coverage"`,
`mode: "handoff"`) and protected completion in `hooks/closeout.cjs` refuse
until coverage is `PASS`.

## Continuation

A resumed or fallback agent does not receive raw conversation history. It
continues the same pass and budget from durable artifacts. Confirmed owner
decisions stay confirmed. A changed envelope, conflicting writer, new
authority, or explicit owner choice starts fresh.

On resume the Planning Orchestrator continues its own final Planning and Design
in the controller session from durable artifacts; it does not dispatch a separate
design author. Specialist-owned content stays with its author: requirements with
the Requirements Engineer and `seit.json` with the Planning Test Engineer. A
missing specialist deliverable is returned to its enabled owner as a named delta
or surfaced as a typed gap, never drafted by the Orchestrator.

## Scribe cadence

Scribe is optional; when omitted or disabled, Orchestrator owns transcription.
When enabled, use one persistent session throughout the Lifecycle, consuming events
or batches by frozen `roles.scribe.cadence`: `event` (default), `phase`, or `lifecycle`.
Never relaunch it per event, phase or batch, poll it, or invent a Scribe when disabled.
After a genuine context reset or inactive session, resume from the last durable
receipt and only missing events under the existing resume authority; do not resend
raw history or reset budgets. Route or authority drift is an explicit amendment,
not permission to silently replace the session. An unavailable enabled Scribe
remains a typed `CAPABILITY_GAP`.

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

## Continuation

A resumed or fallback agent does not receive raw conversation history. It
continues the same pass and budget from durable artifacts. Confirmed owner
decisions stay confirmed. A changed envelope, conflicting writer, new
authority, or explicit owner choice starts fresh.

Router-drafted planning artifacts are a historical exception, not a pattern.
New Lifecycles fail closed on them: dispatch Planning and Design (or a
planning delta) instead of authoring `*-technical-plan.md`, `design.md`,
`workspace.md`, `seit.json`, or `implementation.json` in the Orchestrator
session.

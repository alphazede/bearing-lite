# Troubleshooting

## Delegated work looks stuck

Some agent harnesses may stall after delegated work completes. Before
restarting the task, check whether the assigned agent is still active and
avoid duplicate dispatch.

Wait/status reliability varies by host and route. Use a host-native status
check when one exists. Missing expensive models or wrappers do not make a
route ineligible.

Resume classifies the dispatched session once:

| Class | Action |
|---|---|
| `RUNNING` | Do not duplicate |
| `COMPLETED` | Advance only from durable evidence |
| `INACTIVE` / `EXITED` | Resume from last durable state with an approved fallback |
| `UNKNOWN` | Automatic orchestration returns `WAITING_ON`. Explicit owner-requested resume may replace the agent |

Bearing Lite does not add a watchdog daemon, heartbeat service, global
timeout, or model polling.

## Configuration will not load

- Live user configuration is only `~/.agents/bearing-lite/profiles.json`.
- A leftover `lineups.json` returns `MIGRATION_REQUIRED`. Run onboard-bearing.
- Missing user file means `no_named_profiles`. Do not copy packaged
  `profiles.json` over a user catalog.
- onboard-bearing asks one setting at a time and writes only explicit
  choices.

## Checkout lease conflict

Same checkout plus a live other Lifecycle returns `WAITING_ON` with
sanitized competing identity. Distinct explicitly approved compatible
worktrees may proceed. Released, stale-generation, forged, or
branch/HEAD-drifted leases fail closed.

## Assurance or review seems to loop

Each declared cadence unit allows one review and one aggregated repair.
Deterministic closure follows; there is no automatic rereview. Remaining
material conflict returns to the owner.

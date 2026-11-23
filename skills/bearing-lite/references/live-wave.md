# Live waves

A profile may declare its default in `execution.live_wave` (`"herdr"` or
`"headless"` in `profiles.json`); the freeze copies it into
`profile_freeze.snapshot.execution` and the configuration digest, and Planning
and Design writes it into `journey_settings.live_wave`. Omit `execution` in
the profile and `live_wave` in the plan for legacy headless-by-omission
execution; an omitted plan value counts as `headless`. A plan value that
differs from the frozen mode needs a recorded
`journey_settings.live_wave_owner_amendment` (`{from, to, owner_decision}`),
otherwise final freeze reports `live_wave_profile_mismatch`. Read
`herdr --skill` for Herdr's commands.

When the plan selects `"herdr"` but the launcher reports Herdr unavailable
for the whole wave at dispatch, the Orchestrator records the typed gap
`live_wave_unavailable` and the wave does not pass; do not switch the wave to
headless silently. A role whose harness has no live startup still runs
headless with the recorded reason, as before. A cooperating launcher opens
slice-labelled panes in the wave's own tab without changing focus.

## Messages and completion

Use the wave descriptor supplied by the Orchestrator. Send messages through the
launcher with `bearing-launch message --to <role> --file <request.md>`.
The recipient sees a pointer in this format.

```text
BEARING-MSG <request_id> <path> from=<role>
```

Read the body file relative to the plan directory. Reply through the launcher
with `bearing-launch message --reply-to <request_id> --file <reply.md>`.
Supply `--wave-file` when invoking live launcher commands. At the end of the
assignment, use `bearing-launch done --role <role> --return <file>` to submit
the compact return.

Keep the packet's role, write set, time target, and allowed message pairs.
The launcher owns the exchange and completion records. Keep body files intact
after sending so the digest can be verified. The Orchestrator closes live panes
at the end of the wave and before replacing the active plugin.

## Exchange evidence

The wave's declared evidence artifact is `live/<wave>/exchange.jsonl`. The
launcher appends one JSON object per send or refusal using the
[exchange record schema](../../../schemas/live-exchange-record.schema.json).

| Key | Value |
| --- | --- |
| `time` | UTC ISO-8601 timestamp |
| `from`, `to` | Sender and recipient roles |
| `request_id` | Message identifier |
| `reply_to` | Identifier of an earlier request, or `null` |
| `body_path` | Body file path relative to the plan directory |
| `body_sha256` | Hex SHA-256 of the exact body bytes |
| `delivered`, `allowed` | Booleans for delivery and whether the pair is allowed |
| `attempts` | 1 or 2 for a send, or 0 when the pair was refused (`allowed: false`, `delivered: false`) |
| `role_file_digests` | Map from role to file paths and their hex SHA-256 digests |

Final freeze and closeout handoff report `live_wave.waves`. Closeout reads the
exchange again when given top-level `plan_dir` and otherwise carries the summary
from the final freeze receipt. The wave view reports `live_exchange`. Each wave summary
contains the record count, allowed messages that failed delivery (`undelivered`),
and out-of-table messages (`not_allowed`). Well-formed zero-attempt refusals
are advisory even when the reply target or body file is unavailable.
`missing: true` means the exchange file was absent. A malformed line or an
attempted message with an unverifiable body digest is a named finding.

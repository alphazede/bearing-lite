# Live waves

Set `journey_settings.live_wave` to `"herdr"` to opt in. Omit the setting for
headless execution. Read `herdr --skill` for Herdr's commands. If the launcher
reports that live execution is unavailable, use the same frozen packet and
role headless and record the reason.

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
and out-of-table messages (`not_allowed`).
`missing: true` means the exchange file was absent. These summary fields are
advisory. A malformed line or unverifiable body digest is a named finding.

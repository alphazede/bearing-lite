# Journey profiler fixtures (S01T)

Synthetic inputs for `test/journey-profiler.test.mjs`. No real session, user,
path or secret appears here. Host log key names follow the observed key
inventory in the Bearing 3.0 plan; values are invented.

## Public interface the tests drive

`tools/journey-profiler.mjs` is driven only through its command line:

| Command | Effect |
| --- | --- |
| `profile --journey <file>... [--events <jsonl>]... [--receipt <file>]... [--host-log <harness>=<file>]... --as-of <UTC> --out <dir>` | Writes `<dir>/profile.json` (valid against `schemas/journey-profile.schema.json`) and `<dir>/report.md`, exit 0. Only journeys with `"profiler_tracking": true` are profiled; when none is, no file is written and no host log is read. A missing or malformed `--as-of` exits non-zero and leaves an existing profile untouched. |
| `stage-boundary --journey <file> --stage <name> --at <UTC> --session <orchestrator host session id> --host-log <harness>=<file> --record <file>` | Appends one entry to `stage_boundaries[]` of the private Lifecycle record: Orchestrator calls after the previous boundary up to `--at`. Journey flag off: no record written. |
| `export --profile <profile.json> --out <dir>` | Writes the staged sanitized `<dir>/export.json` (role only) and prints `{"sha256": "<hex of export.json>"}`. It never publishes. |
| `validate <profile.json>` | Exit 0 when the file is valid against the profile schema, non-zero otherwise. |

Every metric is `{"value": <number>}` or `{"value": "unavailable", "reason": "<code>"}`.
A `reason` with a numeric or null value is invalid.

`profile.json` fields read by the tests: `inputs[].sha256`; `hosts.<harness>.status`
(`qualified` or `unavailable`, with `reason`); `usage[]` rows `{journey, attribution,
role, stage, model, harness, metrics: {model_calls, fresh_tokens, cache_read_tokens}}`;
`journeys[]` rows `{journey, metrics: {elapsed_time, owner_wait_time, agent_idle_time}}`;
`cohort.{tokens_per_integrated_slice, tokens_per_completed_journey}`; `owner_ask_rate`;
`diagnostics[]` `{source, record_index, code}` (`record_index` is the 1-based line).

## Join rules exercised

- `bound`: a receipt's `produced_by.session` names the host session and its
  `candidate_revision` equals the journey lease `candidate_revision`; role and
  stage come from the receipt.
- `inferred`: no binding; call `cwd` and branch equal the lease `checkout` and
  `branch`, and the call time is inside exactly one lease window. Role and stage
  are `null` (not evidenced).
- `unattributed`: no lease matches, or several overlapping leases match;
  `journey` is `null` and the usage is excluded from journey and cohort totals.

## Hand totals (`--as-of 2026-11-10T13:00:00Z`)

Claude Code (`claude-code.jsonl`, qualified: `input_tokens` is uncached input;
`fresh_tokens = input + cache_creation + output`). Lines sharing one
`message.id` are one call.

| Session | Harness / model | Label | Calls | fresh_tokens | cache_read_tokens |
| --- | --- | --- | --- | --- | --- |
| sess-bound-1 | claude-code / model-a | bound, jrn-alpha, reviewer, review | 2 | 100+1000+200 + 50+0+300 = 1650 | 5000+6000 = 11000 |
| sess-inf-1 | claude-code / model-b | inferred, jrn-alpha | 2 | 10+20+40 + 1+2+4 = 77 | 30+3 = 33 |
| sess-unattr-1 (12:30, outside every lease) + sess-ambig-1 (11:00, inside both overlapping leases) | claude-code / model-c | unattributed | 2 | 10 + 15 = 25 | 0+5 = 5 |

Codex (`codex.jsonl`, sess-codex-1, inferred jrn-alpha): per-call `usage` only;
`thread_token_usage` is cumulative and must not be added. Cache-inclusive input
normalized: (1000-600) + (500-400) = 500 uncached, cache-write 0, output 200+100
(reasoning already inside output) gives fresh_tokens 800, cache_read_tokens 1000.
Codex normalization is not yet host-qualified, so the reader may instead report
every Codex metric `unavailable`; it may never report another number.

`other-host.jsonl` is passed as agy, cursor-agent, deepcode, muse-code, omp and pi.
None is qualified: every metric from them is `unavailable`.

Journeys: jrn-alpha (complete) elapsed 11:50 - 10:05 = 6300 s from
`events.jsonl`; owner wait = union of 10:30-10:40 and 10:35-10:45 = 900 s;
agent idle unavailable (no dispatch times). jrn-beta (cancelled): no events,
owner wait not tracked, so all three are unavailable. Merged slices for
jrn-alpha: S1, S2 (S3 merge verdict FAIL). Claude-only cohort:
(1650 + 77) / 1 completed journey = 1727; / 2 merged slices = 863.5.

`claude-code-malformed.jsonl`: line 2 is truncated JSON; lines 1 and 3 give
sess-diag-1 (model-d, unattributed) 2 calls, fresh_tokens 3+2 + 4+1 = 10.

`orchestrator-claude.jsonl`, session sess-orch-1: boundary `planning` at 09:30
covers 09:10 and 09:20: 2 calls, input 12, cache-write 24, cache-read 36,
output 48. Boundary `implementation` at 10:00 covers 09:40 and 09:50, whose
records carry no cache-creation field: 2 calls, input 11, cache-write
unavailable, cache-read 15, output 19. The 09:15 call of another session and
the 10:05 call are outside both.

Canaries `CANARY-SECRET-b30103-*`, `CANARY-PROMPT-b30103-*` and
`CANARY-TOOL-b30103-*` are seeded in messages, tool data, environment fields,
owner questions, receipt commands, event refs and the malformed line. They must
appear in no output, report, stream or diagnostic.

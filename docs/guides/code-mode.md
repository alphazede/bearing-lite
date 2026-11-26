# Code Mode pilot

Code Mode is an opt-in pilot. It lets an agent run a short JavaScript routine,
or one typed capability call, through `hooks/code-mode.cjs` and get back one
compact JSON outcome. Raw results and logs stay on disk in the evidence store.
The pilot is off by default. Without `code_mode: true` in the trusted context,
each request goes to the context's direct adapter, as before.

## Requirements

- Linux with Node.js 22 or later.
- `systemd-run --user`, `prlimit` (util-linux) and `bwrap` (bubblewrap) on
  `PATH`, for routines only. Capability requests do not start the sandbox.
- No root access is needed.

## Commands

```bash
node hooks/code-mode.cjs describe --context context.json
node hooks/code-mode.cjs --context context.json < request.json
```

`describe` prints the capability catalogue: `name`, `version`,
`input_schema`, `output_schema` (Draft 2020-12), `effect`, `authority`,
`scope` and `evidence`. The second form reads one request on stdin and prints
one outcome. It exits 0, or 1 when the outcome carries an `error`.

## Trusted context

The host writes the context file. A request or a routine cannot change it.

| Field | Meaning |
| --- | --- |
| `workspace` | Checkout root. Relative plan and routine paths resolve inside it. |
| `evidence_dir` | Evidence store. Results are stored under `code-mode/<sha256>`. |
| `journal_dir` | Idempotency and resume journal. |
| `journey_path` | Journey file. Its `state_generation` is the application state generation. |
| `session_id` | Session that must hold the task activation for `dispatch`. |
| `binding_path`, `binding_sha256` | Frozen route binding and its digest, required for `dispatch`. |
| `grant_path`, `grant_sha256` | Optional frozen dispatch grant file and its digest binding `binding_sha256`, `role`, `packet_sha256`, `write_set` and optional `session_id`. |
| `lock_path` | Named lock held during each `dispatch` effect. |
| `write_set` | Paths a `dispatch` may claim. A path ending in `/` covers a directory. |
| `allowed_capabilities` | Capabilities this context may run. |
| `allowed_direct` | Operations the direct adapter may run. |
| `launcher`, `direct` | Argument arrays for the trusted launcher and the direct adapter. |
| `code_mode` | `true` turns the pilot on. Absent or `false` keeps the direct path. |
| `reviewed_routines` | `{ name: { path, sha256 } }` for reviewed routine files. |
| `limits` | Lower values for `cpu_seconds`, `memory_bytes`, `wall_ms`, `output_bytes`. |

## Requests

Each request has `request_id`, `idempotency_key`, `generation` and exactly
one of these:

- `{ "capability": name, "input": {...} }`: one typed call.
- `{ "code": "..." }`: the body of an async function, at most 64 KiB. It gets
  `call(name, input)` and `require`.
- `{ "routine": name }`: a reviewed routine. Its file must match the reviewed
  SHA-256, or the request is refused with `routine_digest_mismatch`.

Example routine:

```js
return await call("ready-set", { slices: [{ id: "A" }], assignments: {} });
```

## Capabilities

| Name | What it does |
| --- | --- |
| `ready-set` | Runs `hooks/ready-set.cjs` on the input. |
| `lifecycle-state` | Runs `hooks/transition-order.cjs`, or returns `{ generation }` for `{ "read": "generation" }`. |
| `validate` | Runs the `hooks/plan-package.cjs` freeze check on `{ plan_dir, stage }`. |
| `evidence` | Verifies that `{ path, sha256 }` names a file in the evidence store with that digest. |
| `parallel` | Runs up to 16 calls together and reports each call's status. |
| `dispatch` | Starts one role through the trusted launcher. See below. |
| `aggregate` | Returns a typed `{ status, blockers, next_action, evidence_refs }` result after checking each reference. |

A capability that is not in the catalogue goes to the direct adapter only when
`allowed_direct` lists it. A catalogue capability that `allowed_capabilities`
leaves out is refused, and it never falls back to the direct path.

## Dispatch

Before the launcher runs, `dispatch` checks, in order: the binding is present
and its digest matches, the session's task activation is ready, every
`write_set` entry is inside the context write set, the packet digest matches
any supplied `packet_sha256`, and any context grant (`grant_path` and
`grant_sha256`) matches `binding_sha256`, `role`, `packet_sha256`, normalized
`write_set` and optional `session_id`. It then takes the named lock and checks
that the request `generation` equals the journey `state_generation`. It
records the call in the journal before the effect and sends `packet_sha256`,
`idempotency_key` and any `grant_path`/`grant_sha256` to the launcher. On a
resumed request, it asks the launcher to reconcile a call that started but was
not confirmed, proceeds to `dispatch` only if the launcher reports
`NOT_STARTED`, and otherwise preserves the launcher outcome without starting a
second worker. A launcher result other than `COMPLETE` is reported with its
receipt and is not retried.

## Outcome

The outcome follows `schemas/code-mode.schema.json`. It has `request_id`,
`status`, `blockers`, `next_action`, `evidence_refs`, `mode`
(`runtime` or `direct`), and `calls` for `parallel`. Each evidence
reference has a store-relative `path`, the `sha256` of its bytes and a
`kind`: `call`, `result` or `diagnostic`.

A refusal has status `WAITING_ON` and `error.code`. The codes are
`schema_error`, `output_schema_error`, `capability_denied`,
`binding_required`, `binding_mismatch`, `grant_mismatch`,
`activation_required`, `write_set_denied`, `evidence_ref_invalid`,
`routine_digest_mismatch`, `request_limit`, `resource_limit` (with
`error.limit`), `output_limit`, `cancelled`, `partial_effect`, `program_error`
and `sandbox_unavailable`.
`lock_busy`, `stale_state` and `in_progress` mean "retry later". They are
not recorded against the idempotency key. Other outcomes are recorded, and
the same key returns the recorded outcome.

## Sandbox

A routine runs in this chain:

1. `systemd-run --user --scope` sets `MemoryMax`, `MemorySwapMax=0` and
   `TasksMax=64`.
2. `prlimit` sets CPU seconds and 48 open files.
3. `bwrap` gives no network, an empty environment, a read-only system tree
   and a 16 MiB `/tmp` scratch area.
4. `node --permission` allows no child process or worker, and allows reads
   and writes only in `/tmp`.

Defaults are 10 CPU seconds, 512 MiB of memory, 30 s wall time and 1 MiB of
combined stdout and stderr. The context can only lower them. Capability calls
from a routine run in the trusted process over the Node IPC channel.

# Code Mode pilot

Code Mode is an opt-in pilot. It lets an agent run a short JavaScript routine,
or one typed capability call, through `hooks/code-mode.cjs` and get back one
compact JSON outcome. Raw results and logs stay on disk in the evidence store.
The pilot is off by default. Without `code_mode: true` in the trusted context,
each request goes to the context's direct adapter, as before.

## Requirements

- Linux with Node.js 22 or later.
- `systemd-run --user`, `prlimit` (util-linux) and `bwrap` (bubblewrap) on
  `PATH`, for routines only. Routines require systemd 253 or later (or a
  backport of `OOMPolicy=` for scope units). If the user manager rejects the
  required scope properties, the runtime reports `sandbox_unavailable`.
  Capability requests do not start the sandbox.
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
| `grant_path`, `grant_sha256` | Frozen grant required for dispatch. Supply the file and its digest binding `binding_sha256`, `role`, `packet_sha256`, `write_set` and optional `session_id`. |
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

The runtime claims the operation key, then takes the named dispatch lock.
Under that lock it checks the current generation, frozen binding, task
activation, workspace paths and packet bytes. The grant must bind the same
binding digest, role, packet digest and normalized write set. If the grant
names a session, it must match the active session.

Before calling the launcher the runtime records the operation as started. It
forwards the workspace, grant and binding digests, packet digest, write set
and operation key. On recovery it asks the launcher to reconcile. A confirmed
success supplies the saved receipt. Only an explicit `NOT_STARTED` permits
dispatch to continue. An indeterminate effect returns `WAITING_ON`.

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
`routine_digest_mismatch`, `idempotency_conflict`, `lock_unavailable`, `request_limit`, `resource_limit` (with
`error.limit`), `output_limit`, `cancelled`, `partial_effect`, `program_error`
and `sandbox_unavailable`.
`lock_busy`, `stale_state` and `in_progress` mean "retry later". They are
not recorded against the idempotency key. Other outcomes are recorded, and
the same key returns the recorded outcome for the same operation and trusted context. A changed operation or context returns `idempotency_conflict`. An uncertain direct fallback stays pending. The runtime uses Linux `flock` to claim each request before starting work.

## Sandbox

A routine runs in this chain:

1. `systemd-run --user --scope --slice=background.slice` sets `MemoryMax`,
   `MemorySwapMax=0`, `TasksMax=64` and `OOMPolicy=continue` (so routine memory
   kills stay enforced without marking the scope `oom-kill` failed).
2. `prlimit` sets CPU seconds and 48 open files.
3. `bwrap` gives no network, an empty environment, a read-only system tree
   and a 16 MiB `/tmp` scratch area.
4. `node --permission` allows no child process or worker, and permits writes only in `/tmp`. The runner file is also readable.

Defaults are 10 CPU seconds, 512 MiB of memory, 30 seconds of wall time and
1 MiB of combined stdout and stderr. The context may lower these limits.
The broker caps the number of capability calls at 128 per request and reads
routine frames through a byte-limited pipe. Before sending routine code, the
host reads the effective memory, swap and task limits from the child’s cgroup.
The host reports a memory kill only when the kernel records one.

## Turn the pilot on or off

Switch modes only when no request is open. With `code_mode` absent or
false, the runtime calls the direct adapter and writes nothing to
`journal_dir`. With the pilot on, the runtime does not read the direct
adapter's records. A request that is still open on one path is therefore
unknown to the other path, and sending it again there can repeat its effect.

1. Stop sending new requests.
2. Settle each open request on the path that started it. With the pilot on,
   send the same request again with the same `idempotency_key` and the same
   trusted context. The runtime returns the recorded outcome, or it asks the
   launcher to reconcile a dispatch that it recorded as started.
3. Check that no journal entry is open:

   ```bash
   grep -lE '"state":"(running|started)"' "$JOURNAL_DIR"/*.json
   ```

   Each file that the command lists is an open request or dispatch. An empty
   or unreadable journal file is also open, and the runtime answers it with
   `partial_effect`.
4. Change `code_mode` in the trusted context.

Never repeat an effect whose outcome is uncertain. A `WAITING_ON` outcome
with `partial_effect` means that the runtime cannot tell whether the effect
happened. Check the launcher's own records for that role and packet. If no
run started, send a new request with a new `idempotency_key`. If a run
started, or you cannot tell, do not dispatch again. Collect the result of
that run instead. Do not send the request again with the pilot off, because
the direct path does not read the journal. Before you turn the pilot on,
confirm the result of each direct request in the direct adapter's own
records, because the journal holds no entry for them.

Keep `journal_dir`, the `code-mode/` results in `evidence_dir` and the
launcher's receipts after you turn the pilot off or remove it. They are the
record of what each request did. A repeated key replays its recorded outcome
only while its journal entry exists.

### Supported combinations

The pilot needs a Bearing Lite release later than 3.0.1 and a trusted
launcher that accepts the `dispatch` and `reconcile` requests described in
[Dispatch](#dispatch).

| Bearing Lite | Launcher | Result |
| --- | --- | --- |
| 3.0.1 | Any | No Code Mode runtime. 3.0.1 does not ship `hooks/code-mode.cjs`. Ordinary launches work. |
| Later, pilot off | Without Code Mode support | Supported. Requests use the direct adapter as before. |
| Later, pilot on | Without Code Mode support | Not supported. Leave the pilot off. |
| Later, pilot on | With Code Mode support | Supported after a launcher dry run of a saved request passes. |

Turn the pilot on in this order:

1. Update the launcher.
2. Install the Bearing Lite release with the pilot, and leave `code_mode`
   off.
3. Replay a saved request through the launcher's dry-run route check.
4. Turn the pilot on when no request is open.

To roll back, turn the pilot off first, with no request open. Then downgrade
Bearing Lite or the launcher.

### Remove the pilot

1. Turn the pilot off as described above, and configure your host to call
   the direct adapter instead of `hooks/code-mode.cjs`.
2. Install the previous package, or remove `hooks/code-mode.cjs`,
   `schemas/code-mode.schema.json` and this guide in a reviewed change.
   `test/pilot-removal.test.mjs` checks that ordinary commands keep their
   output after this removal.
3. Keep the journal, the evidence store and the launcher receipts.

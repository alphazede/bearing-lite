# Code Mode test contract

These tests are written before the runtime exists. Their CLI entry point is
`hooks/code-mode.cjs`. The fixtures contain no production binding, provider,
agent launch, credential, or private plan. Each case owns its temporary
checkout, evidence store, journal, and application state. The launcher seam
records only local synthetic effects.

## Public interface bound by the cases

- `node hooks/code-mode.cjs describe --context <file>` prints a JSON array of
  capability descriptions. Each entry has `name`, `version`, `input_schema`,
  `output_schema`, `effect`, `authority`, `scope` and `evidence`.
  Input and output schemas are self-contained Draft 2020-12 schemas.
- `node hooks/code-mode.cjs --context <file>` reads one JSON request on stdin
  and prints one compact JSON outcome, including on typed refusal. Requests
  contain `request_id`, `idempotency_key` and `generation`, plus exactly one
  of `{ capability, input }`, `{ code }`, or `{ routine }`. The code is an
  asynchronous JavaScript body in the isolated runner. Its `call(name, input)`
  returns a validated capability result. Ordinary Node operations in the
  sandbox must obey the sandbox limits.
- The context file is a **trusted host input**, not script-controlled
  configuration. It supplies `workspace`, `evidence_dir`, `journal_dir`,
  `journey_path`, `session_id`, `binding_path`, `binding_sha256`, the named
  `lock_path`, the permitted `write_set`, `allowed_capabilities`, and
  `allowed_direct`. It may identify an opted-in runtime with `code_mode: true`,
  reviewed files with `reviewed_routines: { name: { path, sha256 } }`,
  lower limits with `limits: { cpu_seconds, memory_bytes, wall_ms, output_bytes }`,
  and a host event with `hook_event`. The synthetic journey has an application
  `state_generation` separate from its checkout lease generation. Relative
  plan and routine paths resolve within the workspace.
- Capability names are:
  - `ready-set`: existing ready-set input and output.
  - `lifecycle-state`: existing transition-order input and output; the
    `{ read: "generation" }` read returns `{ generation }`.
  - `validate`: `{ plan_dir, stage }`, existing plan-package result.
  - `evidence`: `{ path, sha256 }`, verified reference to a file in the evidence store.
  - `parallel`: `{ calls: [{ capability, input }] }`, per-call results.
  - `dispatch`: `{ role, packet, write_set }`, verified launcher result.
  - `aggregate`: `{ status, blockers, next_action, evidence_refs }`, validated typed result.
- The outcome shape is defined as `schemas/code-mode.schema.json#/$defs/outcome`.
  It has `request_id`, `status`, `blockers`, `next_action` (string or null),
  `evidence_refs` and `mode` (`runtime` or `direct`). Success is
  `COMPLETE` unless the requested aggregation yields another valid status.
  Errors carry `error.code`, plus `error.limit` for resource limits. Parallel
  calls report individual `{ capability, status, error? }` summaries in
  `calls`, including successful siblings of a failed call.
- Each evidence reference has a path relative to the evidence store and the
  SHA-256 of its actual bytes. Call output is stored as the exact
  `JSON.stringify(result)` bytes, identified by `kind: "call"` and
  `capability`. A program return is `kind: "result"`; raw log evidence is
  `kind: "diagnostic"`. Truncation records `bytes`, `observed_bytes` and
  `truncated` on the relevant diagnostic reference. No raw result or log is
  included in the compact outcome. A generation-read result is retained
  before later effects, so an observer can synchronize on an actual read.
- Typed failure codes used in the tests identify the refusal:
  `schema_error`, `output_schema_error`, `capability_denied`,
  `binding_required`, `binding_mismatch`, `activation_required`,
  `write_set_denied`, `evidence_ref_invalid`, `routine_digest_mismatch`,
  `request_limit`, `resource_limit` (limit `cpu`, `memory`, `wall`,
  `scratch` or `file_descriptors`),
  `output_limit`, `cancelled`, `partial_effect`, and the non-closing
  `lock_busy`, `stale_state` or `in_progress` conditions. Conflicting live
  work may return a wait rather than block a second caller.

## External seam

The trusted context supplies command argument arrays `launcher` and
`direct` to bind the external boundary. The request and sandbox cannot
choose these commands. The fixture launcher accepts a single JSON object
on stdin; the dispatch adapter receives the dispatch input together with
the verified `binding_path`, `binding_sha256`, and an operation
(`dispatch` or `reconcile`). It returns `{ status, receipt?, error?, message? }`.
A reconcile read returns an observed durable receipt or `NOT_STARTED`.
The direct adapter accepts `{ capability, input }` plus the same binding
fields for dispatch. It calls the real ready-set evaluator for that
operation. Its synthetic dispatch records the same kind of effect as the
launcher.

The fixture deliberately separates a durable effect from its response.
Pauses signal readiness with an owned file before or after the effect.
The caller can cancel or resume a request without guessing from elapsed
time. The fixture never starts a real role process. Production integration
uses its own trusted launcher binding.

## Golden provenance

`golden.json` captures the public ready-set, transition-order and
plan-package draft function outputs at commit
`d6007f6e547296ba57351d5921105166fcb270a9` (3.0.1). Inputs are synthetic
and constructed in `fixture.mjs`; `capturedGoldens` verifies the direct
functions against those fixtures. The plan uses the existing
`planning-contract-fixture.mjs` helper. The byte comparison is against
fixed captured outputs, not against the candidate runtime's implementation
of the same algorithms.

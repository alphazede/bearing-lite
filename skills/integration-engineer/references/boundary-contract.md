# Boundary/Data-Flow Contract (planning session)

The Planning Integration Engineer owns cross-component interaction
completeness for the proposed change: data paths, state and protocol behavior
including illegal transitions, and trust boundaries. Architectural Alignment maps the existing
topology; this session decides how the change crosses it; the Systems Modeler
owns formal views; the Planning Test Engineer turns the result into SEIT cases;
the Implementer receives defined contracts and never invents missing
integration behavior. The execution session's independence and Lifecycle-end
assessment are unchanged.

## Where it lives

No sixth canonical planning artifact. Author the contract in `design.md`
(interfaces and boundaries), the optional System Catalog, and model views; the
Plan Integrator copies it mechanically into `implementation.json`
`boundary_contract`, which `hooks/plan-package.cjs` checks at both freezes.
Distinguish observed repository evidence (`evidence: "observed"`) from proposed
design (`"proposed"`).

## Contents, as applicable

- `flows[]`: `id`; `source` and `sink` each with `component` and `owner`
  (source and sink ownership); `path` (hops); `transformations`
  (parsing, serialization, encoding, validation, sanitization); `side_effects`
  (state writes, externally visible effects); `authority`; `evidence`;
  `failure_recovery` (error propagation, retry, rollback); `seit_rows`.
- `state_machines[]`: `id`, `component`, `transitions` as
  `{from, event, to, output}` (current state + input -> next state + output or
  error), `illegal_transitions` as `{from, event, handling}`, optional
  `ordering` (handshakes, timeouts, reset, privilege prerequisites), `model`
  (the Systems Modeler model id when formal modeling is needed) or
  `model_na_reason`, and `seit_rows`.
- `trust_boundaries[]`: `id`, `crossing` (authentication, authorization,
  cryptographic, process/container, network zone, hardware/firmware,
  privilege level, tenant or data ownership), `enforcement` (the validating
  component and check), and `seit_rows`.
- `gaps[]`: `id`, `status`; anything other than `resolved` blocks.
- Or `{ "not_applicable": true, "reason": "..." }` with a concrete
  not-applicable rationale when no material cross-boundary behavior exists.

## Contract authority

An existing formal contract (OpenAPI, Protocol Buffers, JSON Schema, message or
event schema, database constraint, ABI or wire format, register map, strict
type, published protocol standard) is the `authority`; record it and its
compatibility implications rather than inferring behavior from neighboring
code. Without one, name the observed source of truth.

## Stop conditions

Return `GAPS` or `OWNER_DECISION_REQUIRED`, never `CANDIDATE_READY`, when a
material interface, source/sink ownership, protocol/state ordering, required
trust enforcement point, incompatible contract version, or a cross-boundary
failure/recovery path needed for implementation is unresolved. Record it as an
open gap; the freeze fails and implementation dispatch stays closed.

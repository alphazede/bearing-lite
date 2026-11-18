# Allocation inputs for final planning/design

Data dependencies: Architectural Alignment and Scope supplies source-backed
context and confirmed decisions; at specialist dispatch, the Planning
Orchestrator freezes the requirement skeleton (UIDs and titles) and active
decisions so `mbse` (`roles.mbse.sessions.planning`) and `integration_test`
(`roles.integration_test.sessions.planning`) start in parallel. `mbse` authors
and self-checks requirements from that context and returns the modeling mode
and placement receipt (current flow, candidate placements with `file:line`,
constraints, and requirement-to-component mappings), while `integration_test`
authors `seit.json` against the frozen requirement UIDs. Any needed decision
change surfaced mid-wave waits for assembly rather than amending decisions
mid-wave.

The Planning Orchestrator uses the placement receipt as the input to allocation
when finalizing the technical plan and design: each allocated requirement cites
the receipt row it relies on, and the final self-check confirms every required
allocation is present. It preserves requirement IDs, source bindings, and
definitions, and creates no duplicate register. During assembly, the Planning
Orchestrator may apply purely mechanical ID and hash binding fixes with an edit
record, while any change of meaning returns to the owning author under an
authorized return (zero author-known relaunches).

When `mbse` is selected or the task requires placement evidence but
the role is unavailable, record a typed capability gap and an owner decision
(`OWNER_DECISION_REQUIRED`); never allocate silently. When the role is inactive
and not required, allocate from existing architecture evidence and cite it.
An `mbse` placement that contradicts a requirement is resolved in its open
assignment before return or returned to the owning author under an authorized
delta; the final package does not freeze with the contradiction open.
Do not invent placements, circular dependencies, new agents, or another
invocation. See `../../bearing-lite/references/planning-assembly.md`.

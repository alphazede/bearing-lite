# Allocation inputs for final planning/design

Data dependencies, in order: Architectural Alignment and Scope supplies
source-backed context and confirmed decisions; the Requirements Engineer authors
and self-checks requirements from that context without component placements;
a selected Systems Modeler then consumes those requirements and existing
architecture and returns a placement receipt (current flow, candidate placements
with `file:line`, constraints, and requirement-to-component mappings).

The Planning Orchestrator uses the placement receipt as the input to allocation
when finalizing the technical plan and design: each allocated requirement cites
the receipt row it relies on, and the final self-check confirms every required
allocation is present. It preserves requirement IDs, source bindings, and
definitions, and creates no duplicate register.

When the Systems Modeler is selected or the task requires placement evidence but
the role is unavailable, record a typed capability gap and an owner decision
(`OWNER_DECISION_REQUIRED`); never allocate silently. When the role is inactive
and not required, allocate from existing architecture evidence and cite it.
A Modeler placement that contradicts a requirement returns to the owning author
as a named delta; the final package does not freeze with the contradiction open.
Do not invent placements, circular dependencies, new agents, or another
invocation. See `../../bearing-lite/references/planning-assembly.md`.

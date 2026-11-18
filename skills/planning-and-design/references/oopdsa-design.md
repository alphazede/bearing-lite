# OOPDSA Design

OOPDSA (Object-Oriented Programming, Data Structures, and Algorithms) assigns
each requirement and contract to its owning component and fixes data structures
and algorithms before implementation. Method-skill routing selects this
procedure for existing stages; it adds no role, review or gate.

## Plan: author the section

In `design.md`, after `## Interface Option Check`, Planning and Design writes
`## OOPDSA Implementation Design` with these subsections. Use repository names
and reuse existing components first.

1. **Requirements trace.** One line per requirement or `CONTRACT-*` ID: its owning module, class or function.
2. **Ownership and boundaries.** State holders, permitted mutators and component interfaces. Name the reused abstraction, or why a new one removes real duplication, branches or invalid states.
3. **Pattern and plain-code decisions.** Patterns used, simpler options rejected and frameworks, layers or class hierarchies deliberately omitted.
4. **Data structures and algorithms.** For each hot path: structure, key, access pattern, time/space complexity, required input size and where current cost was measured (or mark it unmeasured). For stateful logic, name the structure that holds the domain rule (a state machine, a closed set of variants, a lookup table or a typed record) and the invalid states it prevents. Apply this when the change adds another branch to an existing chain or a flag that must stay in step with another flag; keep plain code when the logic is local and unlikely to grow. Name the state-and-types method for invalid-state prevention, boundary parsing, schema-derived types and exhaustive branches. Do not copy that method here. Shared engineering methods stay named from the private skills tree; this reference adds no shared-skills repository.
5. **Edge cases and invariants.** Empty, duplicate, boundary, ordering and failure cases, with each typed result. For a state-changing command, state what a second run, or a rerun after a crash at any step, leaves behind.
6. **SEIT proof obligations.** The SEIT row proving each invariant and each complexity bound that matters.

A trivial plan writes `oopdsa_skip: trivial - <reason>` instead. Each non-trivial
slice in `implementation.json` lists `OOPDSA Implementation Design` in `design_lenses`
and its owned `CONTRACT-*` or requirement IDs.
When a change affects a component, design that component's model as a whole
first, schedule removals before additions, and deliver the smallest complete
change in waves. Keep one source of truth per decision.

## Packet: carry the rows

For a slice whose `design_lenses` include `OOPDSA Implementation Design`, the packet author copies its rows into
`STATE / INPUTS`: owner component, structures, complexity bounds and invariants; cite the `design.md` heading.
In `RETURN / STOP`, require every deviation as a finding with its reason. A lens name alone is an incomplete packet.

## Implement: follow the rows

The Implementer uses the named owners, structures and bounds. Helpers, names and local choices remain discretionary
when they preserve those rows, the write set and contracts. If code proves an approved row invalid, stop affected work
and use the existing design-gap/amendment path: record the amendment before affected implementation resumes.
Report the deviation and its evidence; ownership, write-set or contract changes follow the same existing path.

## Review: check against the rows

The Reviewer checks the candidate against the packet's rows for design conformance. A misplaced owner, a structure or
algorithm breaking the stated bound on a reachable path, or an unreported deviation is a finding under the normal
evidence rule (`file:line` plus a reproducer, benchmark or failing test). Style preferences are not findings.

## Return

The acting role states `OOPDSA: applied`, `OOPDSA: skipped - <reason>`, or `OOPDSA: gap - <missing input>`.
Loading proves nothing by itself; the section, packet rows and reported deviations are the evidence.

Do not use to add classes, layers or patterns a change does not need.

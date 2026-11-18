# Real-app verification

For user-path cases, reuse or maintain one repository-local procedure beside
existing verification assets. Executable test helpers follow the Test
Implementer handoff. Discover commands and harnesses from code; ask only for
unobservable prerequisites.

## Map features to cases

Map scoped features and entry points to existing cases, preconditions, drive
steps, observable end states, and known limitations; report unmapped surfaces.
Maintain links as features change; never create another requirements authority.
Each feature entry lists its sub-behaviors, every user entry point, drive steps
that pair a user action with an exact command and an observable result, and
known traps. Name a missing surface only with the source path that exposes it.

## Launch and environment

Record exact launch/build, migrations/seeds, usable-readiness signal, and a
read-only doctor (build, ownership, auth). Isolate ports/data/profiles;
serialize shared instances. Respect protected-action authority and use safe
fixtures.

## Drive real paths

Drive real UI/CLI/API paths with existing harnesses and stable
selectors/commands. Capture action plus result and applicable
file/database/delivery effects; mocks only at established external boundaries.
Observe dry-run effects. Preserve missing-precondition failures.
Use the path a user takes, never an internal setter or a test-only endpoint,
and confirm a stored change through a second read-only view. Report an
unreachable entry point with the command tried and the missing prerequisite,
and add that prerequisite to the map. Never count a skipped entry point as
verified through a different one, and never weaken a journey to make it pass.

## Cleanup keeps evidence

Name evidence paths outside scratch state. Clean only owned
processes/resources, including after failures; retain proof and verify it
survives. Document executable helper invocations.

## Trial before claiming usable

Trial the procedure end to end on one mapped feature before claiming it usable;
remaining features and stand-in/target differences stay unverified. This trial
does not replace case coverage, reliability qualification, or independent
assurance. Unrun remains `needs_evidence`.

## Maintain the procedure

When features change, read each mapped feature's source, then drive every
feature live, even when the source looks unchanged. Classify each mismatch:
wrong map text is drift (fix the map), working behavior the harness cannot
drive is a harness gap (fix the harness and re-drive it), and broken behavior
is a product defect routed to bug triage, never hidden by a map edit. Run the
doctor again after any failed drive and relaunch from a known state when it
cannot see the fault. Report the pass as `PASS` with no correction, `PASS`
with changed paths, or `NEEDS_EVIDENCE` with the blocker.

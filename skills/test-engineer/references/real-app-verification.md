# Real-app verification

For user-path cases, reuse or maintain one repository-local procedure beside
existing verification assets. Executable test helpers follow the Test
Implementer handoff. Discover commands and harnesses from code; ask only for
unobservable prerequisites.

## Map features to cases

Map scoped features and entry points to existing cases, preconditions, drive
steps, observable end states, and known limitations; report unmapped surfaces.
Maintain links as features change; never create another requirements authority.

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

## Cleanup keeps evidence

Name evidence paths outside scratch state. Clean only owned
processes/resources, including after failures; retain proof and verify it
survives. Document executable helper invocations.

## Trial before claiming usable

Trial the procedure end to end on one mapped feature before claiming it usable;
remaining features and stand-in/target differences stay unverified. This trial
does not replace case coverage, reliability qualification, or independent
assurance. Unrun remains `needs_evidence`.

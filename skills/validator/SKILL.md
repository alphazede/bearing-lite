---
name: validator
description: >
  Compatibility diagnostic for plans that still name Validator. Use when
  an existing plan assigns Validator. Do not use for new Journeys,
  evidence validation, or as an active assurance role.
---

# Validator

Compatibility only. Not an active assurance role. Assurance Test Engineer
owns VALIDATING. Router reroutes Validator assignments.

## Inputs and match

- **Inputs:** a plan that still assigns `Validator`, plus the recorded
  Journey snapshot.
- **Match:** an existing plan names Validator as an assigned role.
- **Non-match:** new Journeys, Test Engineer sessions, Park Ranger,
  Surveyor.

## Algorithm

1. Do not validate evidence, score rubrics, or run assurance. Read
   identities only from the recorded Journey snapshot, never from the
   current global defaults file.
2. Return `REROUTED` to the Router with a diagnostic that Validator is
   compatibility-only and is not an active assurance role; treat the
   assignment as unused and continue under Assurance Test Engineer.
3. Preserve the checkout lease. Do not write planning state.

## Return and recovery

Return `REROUTED` with verdict, candidate_ref, changed_paths, tests,
findings, and blocker. Findings name the compatibility path.

Never implement, self-assure, select models, or mutate remotes.

# Handoff compiler design

Observer: Implementer, slice S08, 2026-11-17. Base revision: bearing-lite `12bd16e`. This note describes `tools/compile-handoff.mjs` and `schemas/handoff.schema.json`. It does not change `skills/prompt/SKILL.md`.

Maintenance owner: bearing-lite maintainers. Update this note when the compiler CLI or the handoff schema changes.

## Behavior

The compiler reads frozen records and writes one JSON object to stdout. It does not write a file, start a process, read a live profile catalog, or call a model. A second run on the same bytes emits the same stdout.

`PACKET_READY` is a projection. `write_set` is a copy of the slice's recorded write set. `route` and `capabilities` are copies of that role's frozen binding. Identity digests are the byte hashes of the files that were read. None of these fields is a grant.

`COMPILATION_GAP` exits 1. The JSON has `outcome` and `gaps` only. A missing or empty objective, observable acceptance, write set, existing command, or named evidence is a gap. So is a digest mismatch, an unknown slice, an ineffective or conflicting authority envelope, or a role with no frozen route.

## Input trace

| CLI input | Frozen record | What is copied |
| --- | --- | --- |
| `--plan`/`implementation.json` pinned by `--implementation-sha256` | selected slice: role, wave, goal, write set, command ids, proof-row ids, authority id | identity, objective, write set |
| `--plan`/`seit.json` | proof cases and existing commands named by that slice | acceptance and command strings |
| `--authority` pinned by `--authority-sha256` | envelope id, `effective`, prohibited actions | authority id and owner-only actions |
| `--binding` pinned by `--binding-sha256` | `snapshot.roles[<role>]`, `review`, `deterministic_verification` | route and capabilities |
| `--candidate` | caller-supplied candidate revision | `identity.candidate_revision` |
| `--slice` | assignment id already selected by the Orchestrator | which slice is projected |

The role skill path is `skills/<role_key>/SKILL.md`, derived from the slice role name (`Implementer` becomes `implementer`). The compiler does not open that file and does not choose a role. A `fellow` route is not selected for the assignee.

AMENDMENT: F04 names a package digest and a lease generation. The frozen S08T CLI pins only the authority file, the binding file, and `implementation.json`. The compiler follows that CLI. `seit.json` is read from the same `--plan` directory and has no separate digest flag.

## Write set and expected files

Expected-file containment is a linear scan. An entry is inside only when the repo prefix matches and the lexical path equals a write-set file or sits under a write-set directory (trailing `/`). `..` that climbs above the root is outside. `parser-evil/` is not inside `parser/`. An outside path stays in `expected_files` with `inside_write_set: false` and does not enter `write_set`. The packet tells the assigned agent to stop and return that need to the Orchestrator.

Cost is unmeasured. The input is one slice. The scan is O(expected files × write-set entries) string comparisons.

## Packet text

Seven sections, Prompt template order: `ROLE / SESSION`, `STATE / INPUTS`, `OBJECTIVE / ACCEPTANCE`, `AUTHORITY`, `LOOP`, `VERIFY`, `RETURN / STOP`. Role, canonical skill, frozen route, authority id, and owner-only actions are rendered before the slice goal, write set, and proof ids, so two slices of one wave and role share that prefix. VERIFY names each resolved command and the acceptance-to-evidence lines. The compiler does not copy other slices or `traceability` notes.

## Schema

`schemas/handoff.schema.json` is Draft 2020-12 and closed (`additionalProperties: false`). An extra authority field fails validation. The schema does not widen the recorded write set.

## Promotion

This compiler does not replace the Prompt skill. The default handoff path stays `skills/prompt/SKILL.md` until a promotion record says promote.

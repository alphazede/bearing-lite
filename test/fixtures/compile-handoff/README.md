# Handoff compiler fixtures (S08T)

Synthetic frozen inputs for `test/compile-handoff.test.mjs`. No real plan,
route, session, path or secret appears here. Every test copies this directory
into a fresh `mkdtemp` root and works on the copy.

| File | Role |
| --- | --- |
| `package/implementation.json` | One wave `W1` with slices `S1` and `S2` (same role, different write sets). `S1.expected_files` lists paths inside and outside its recorded `write_set`. `traceability.notes` holds a raw-history canary. |
| `package/seit.json` | Command `CMD-FX-UNIT` and proof cases `SEIT-FX-1`, `SEIT-FX-2`. |
| `authority.json` | Effective envelope `AUTH-FX` (valid against `schemas/authority.schema.json`). |
| `binding.json` | Frozen profile binding: `implementer` route with two ordered fallbacks, plus `test_implementer`, `reviewer` and `fellow` routes, `review` and `deterministic_verification` capabilities. |
| `final-freeze/` | A second plan that final freeze accepts (Alphazedehq#779): `T0`, `P0` and `D1` have no SEIT proof rows; `I1` has no `command_ids` and shares proof row `SEIT-FF-1` with Test Implementer slice `T1`; `P0` is a light slice. Its `binding.json` carries a `scoped_owner_amendment` for `implementer` and `test_implementer` (the latter with empty `ordered_fallbacks`); `light_implementer` keeps its snapshot route. It uses the top-level `authority.json`. |

## Public interface the tests drive

`tools/compile-handoff.mjs` is driven only through its command line:

```text
node tools/compile-handoff.mjs --plan <dir> --slice <id> --candidate <rev>
  --authority <file> --authority-sha256 <hex>
  --binding <file> --binding-sha256 <hex>
  --implementation-sha256 <hex> --seit-sha256 <hex>
```

The `*-sha256` flags are the expected byte digests of the frozen inputs
(`<plan>/implementation.json` and `<plan>/seit.json` for the corresponding pins).

Success: exit 0, stdout is one JSON packet with `outcome: "PACKET_READY"`, valid
against `schemas/handoff.schema.json`, byte-identical for identical inputs. The
compiler writes nothing (stdout only) and starts no process.

Packet fields read by the tests:

- `identity`: `slice`, `wave`, `role`, `candidate_revision`, `authority_id`,
  `authority_sha256`, `binding_sha256`, `implementation_sha256`, `seit_sha256`.
- `write_set`: the recorded slice `write_set`, exactly (same entries, same order).
- `expected_files[]`: `{path, inside_write_set}` for each `expected_files` entry,
  guidance only. An entry is inside when it has the same `<repo>: ` prefix and its
  normalized path equals a write-set file or lies under a write-set directory
  (trailing `/`).
- `route`: for the slice role key (`Implementer` -> `implementer`,
  `Test Implementer` -> `test_implementer`), the `binding.scoped_owner_amendment`
  entry when it is an object with `harness` (`enabled: true`, its
  `harness`/`model`/`reasoning` as `primary`, its `ordered_fallbacks` or `[]`),
  else a deep copy of `binding.snapshot.roles[<role key>]`. This is the route
  guard's precedence.
- `capabilities`: `{review, deterministic_verification}` deep copies from the
  binding snapshot.
- `commands[]`: `{id, command}` resolved from `seit.json` `procedures_and_commands`
  for the slice `command_ids`. When that list is empty, the ids come from the
  Test Implementer slices whose `seit_proof_rows` overlap the slice's rows; with
  no such slice the list is empty.
- `acceptance[]`: `{id, pass_fail_rule, observable_evidence}` resolved from
  `seit.json` `proof_cases` for the slice `seit_proof_rows`. When that list is
  empty, one row `{id: <slice id>, pass_fail_rule: goal, observable_evidence:
  stop_condition}`.
- `sections[]`: `{title, body}` with the seven Prompt template titles in order:
  `ROLE / SESSION`, `STATE / INPUTS`, `OBJECTIVE / ACCEPTANCE`, `AUTHORITY`,
  `LOOP`, `VERIFY`, `RETURN / STOP`.
- `text`: the rendered packet. Stable material (role, canonical role skill path,
  frozen route, capabilities, authority id and owner-only actions) comes before any
  slice-specific value, so two slices of one wave and role share a byte prefix.

Required-field mapping (B30-327): objective = slice `goal`; observable acceptance =
slice `seit_proof_rows`, or the goal when the list is empty; write set = slice
`write_set`; existing commands = slice `command_ids` or the paired Test
Implementer commands (each must resolve); named evidence = `observable_evidence`
of each resolved proof case, or `stop_condition` when the proof-row list is
empty. A missing `seit_proof_rows` or `command_ids` field, and an empty
`command_ids` on a `work_class: "light"` slice, are gaps, as final freeze
refuses them.

Gap: exit 1, stdout JSON `{"outcome": "COMPILATION_GAP", "gaps": [{"field", "code"}]}`
with no `text`, `sections` or `write_set`. `field` is one of `objective`,
`acceptance`, `write_set`, `commands`, `evidence`, `authority`, `binding`, `route`,
`implementation`, `slice`, `candidate`. Inputs are never modified.

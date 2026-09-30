# Gate report (bounded)

Verdict block first: verdict, candidate_ref, and the
`lint-sdoc.py --profile library` receipt.

Failing rows first, one section per failing row, each with UID,
checklist item, evidence, and the exact corrected text.

Then a one-line-per-row PASS table (`| UID | PASS | note |`).
Never write a prose section or heading for a PASS row.

Then owner questions, then decision coverage as a compact list
of uncovered IDs only (`uncovered: none` when empty).

The full per-check (CHK) matrix is optional and only as a
machine-readable JSON sidecar file, never prose.

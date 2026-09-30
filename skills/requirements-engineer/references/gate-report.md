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

## Typed findings

Each failing row has exactly one aggregated finding in the machine-readable
report: `{uid, finding_type, checklist_item, evidence, corrected_text?}`.
`finding_type` is required and is exactly `exact_text` or `requires_regate`.

- `exact_text`: wording-only correction with the complete verbatim corrected
  statement in `corrected_text`. No semantic, allocation, verification, rationale,
  glossary-definition, or reference changes. Never use it for unresolved judgment.
- `requires_regate`: every other correction or uncertainty. Proposed text may
  be supplied, but author realization does not close the finding.

The Orchestrator consumes these rows per
`../../planning-and-design/references/correction-loop.md`: exact-text closure
needs a changed-UID-set check, verbatim/non-text preservation, candidate-bound
workspace lint, and resolving cross-references. No gate round is spent on
exact_text in any round; only requires_regate rows return to this specialist.
Record mechanical receipts and residuals at the integrated owner gate.

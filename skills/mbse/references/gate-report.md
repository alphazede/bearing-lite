---
type: agent-reference
title: MBSE Requirements Author Self-Quality Pass and Return
tags: [bearing, requirements, mbse]
---

# Self requirements-quality pass

MBSE authors the requirements, then checks its own draft using the selected
Requirements Engineering method's authoring/checklist/quality criteria. This is
one assignment with distinct drafting and checking activities; it is not a
second agent, an independent review, or a new invocation.

## Check and repair

For each requirement, check clarity and singular behavior, precision (no vague
terms; quantities, units, and conditions defined), consistency with other rows,
decisions, and definitions, necessity and source rationale, feasibility within
the confirmed architecture, stable identity, traceability to decisions and
parents, measurable acceptance, and verifiability with an intended verification
method. Resolve definitions, references, and applicable standard clauses against
actual evidence. Preserve register authority and distinguish Lifecycle-local rows.
Use the method's semantic checklist; mechanical lint alone does not prove quality.

Inputs are the confirmed Alignment/Scope workspace, its decision batch and
quantity table, and existing architecture. Do not wait for, invent, or cite later
outputs: SEIT case IDs belong to Integration and Test (planning) and final
component allocations to Planning and Design. Run the register precheck at
`--stage requirements` (see `precheck.md`); its `pending_bindings` name
`integration_test` and block final assembly until they are completed.

Inspect the findings, repair your own permitted requirements, and recheck
affected rows and references in this invocation. Imported method guidance does
not grant extra agents, runs, review stages, or an unconfigured retry allowance.
Return a typed gap for missing methods, missing/stale evidence, unresolved owner
intent, or a correction outside authority. Do not invent a passing result or accept
an unresolved fixable requirement defect as a ready draft.

## Bounded author return

Verdict block first: verdict, candidate_ref, exact changed paths, and the stage
precheck and `lint-sdoc.py --profile library` receipts (when that lint applies;
a missing required lint is a typed gap) reported as digests, commands, and exit
codes—not narrative logs. Honor the packet's time target; at the limit, return
what you have and list the gaps.

Failing rows first, one section per row still failing after self-repair, each
with UID, checklist item, evidence, and the exact corrected text or the owner
question that blocks it. Corrections already made and rechecked are listed as
one line each: UID, checklist item, correction.

Then a one-line-per-row PASS table (`| UID | PASS | note |`).
Never write a prose section or heading for a PASS row.
Every pass reports added, merged and removed counts, with a reason for each
addition.

Then owner questions, then decision coverage as a compact list
of uncovered IDs only (`uncovered: none` when empty).

The full per-check (CHK) matrix is optional and only as a
machine-readable JSON sidecar file, never prose.

## Typed open rows

A row that remains open carries one machine-readable finding:
`{uid, finding_type, checklist_item, evidence, corrected_text?}`, where
`finding_type` is exactly `exact_text` (wording-only, complete verbatim corrected
statement) or `requires_regate` (any other correction or uncertainty). Fold all
known corrections into this first return without expecting a planning
correction relaunch; during planning assembly the Planning Orchestrator applies
any remaining exact fixes, and an authorized end-of-planning review repair
consumes typed open rows per
`../../planning-and-design/references/correction-loop.md`.

`READY` requires all assigned quality checks to pass with no fixable defect
remaining; recorded pending bindings owned by later authors are not defects of
this stage. When MBSE's own artifacts are complete and remaining open items
belong to the Orchestrator or another author, return `CANDIDATE_READY` with
`external_open_items` (`id`, `owner`, `summary`, `status`); this spends no
closing return, and the freeze refuses until each listed external item is closed
by its owner. Author evidence does not assert independent review or owner
acceptance. A later explicitly requested review keeps its separate scope and
allowance; it is not required to complete this author self-quality pass.

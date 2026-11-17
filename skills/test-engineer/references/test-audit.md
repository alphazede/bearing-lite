# Test audit

A test audit is selected work. It is not a gate on every slice. Planning and
assurance both apply the behavior-not-implementation principle in
`verification-case.md` under Behavior, not implementation.

## When selected

Select an audit when the owner asks, a review finds implementation-pinned tests,
or a suite's cost is a measured bottleneck.

## Planning record

Apply the behavior-not-implementation principle in `verification-case.md`.

When an audit is selected, the SEIT or validation plan records all of the
following before any test is removed:

- selection reason
- scope
- slices
- behavior-inventory format: distinct behaviors per test file
- coverage-superset criterion
- mutation sample size chosen for this audit, with no default score
- protected tests
- one full-suite run on the combined result

Protected tests are one behavior test for each money, security, authority and
settlement guard in scope, and one behavior test for each owner-locked golden
output in scope.

The coverage-superset criterion is set comparison, not a percentage. For each
product file, the covered-line set and the covered-arc set after the audit are
supersets of the sets before it. A lost line or a lost arc is a dead-code list
for the owner. It is not a passing loss proof.

## Reduction

Build the distinct-behavior inventory. Keep the strongest behavior test for each
behavior and each distinct edge case. Merge repeated control flow into a
parameter table. Remove a duplicate, retired-feature, superseded-harness or
implementation-only test only after the loss proof passes.

A speed-only change does not delete, skip or weaken a test. Deletion is allowed
only inside a selected audit whose loss proof passes.

## Assurance report

Apply the behavior-not-implementation principle in `verification-case.md`.

Assurance evaluates a bound candidate and reports. It does not rewrite the
candidate's tests. A repair goes to a Test Implementer packet.

For each slice, the report contains:

- test count, function count, line count and wall time, before and after
- deletions grouped by reason, each with its covering test
- the line and arc comparison
- the mutation table: each sampled one-line behavior break, the remaining
  covering test, and the observed result
- typed gaps

An unrun or uncaught break is a typed gap, not a pass. A missing protected test
is a typed gap, not a pass. A missing baseline is a typed gap, not a pass.

## Execution

Run each slice audit on the audited files only. Then run one full suite on the
combined result. Repository gates still run. The audit does not waive them and
does not skip the combined run.

Order: record the selection, bind the before candidate and its covered sets,
let the authorized test author change the slice, then assess that bound result
without editing it. Report the slice only when the loss proof passes. Report
the combined result only after the full suite and each touched repository gate
pass on that same candidate.

The assessor does not edit candidate tests or product code, does not hide a
failing sample, and does not treat a speed-only deletion or a stale candidate
as approval.

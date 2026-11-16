# Requirement quality gate

Run this gate after authoring and after the method's checklist. Do not
author here. Do not merge checklist concerns into the authoring method. Do
not persist outside approved draft authority. Do not choose models. Do not
write product tests. This gate is a procedure, not a register.

## Preconditions

- Candidate statement plus the authoring fields from the method skill
- The method's requirement checklist
- Request is not persistence, model choice, or product-test authoring

If the request is persistence, model choice, or product tests, return a typed
gap and write nothing.

## Procedure

1. Load every checklist row. Skipping a row is `FAIL` unless the record
   marks `N/A` with a scope reason.
2. For each row, apply the named check type to the candidate and record
   `PASS`, `FAIL`, or `N/A`.
3. On `FAIL`, record the row's typed failure and the evidence string. Do not
   invent a new failure code.
4. On `N/A`, record the reason. A blank reason becomes `FAIL`.
5. Aggregate:
   - `PASS` if every row is `PASS` or justified `N/A`
   - `FAIL` if any row is `FAIL`
6. Return the record below. Do not treat this record as review or publication.

Return concrete failures to the author, then recheck affected rows after
correction under the method's bounds. This author loop does not create an
independent review and does not consume its review or repair budget.

## Bounds

Keep author corrections within the assigned scope: correct concrete findings,
recheck affected requirements, and retain candidate-bound evidence. Do not impose
a fixed correction-round limit. Stop when the quality gate passes, a typed gap
prevents progress, or no new evidence, hypothesis, or strategy supports another
attempt. Preserve any explicit owner-set limit.

Author checks and corrections are not an independent review and do not consume
review or repair budget. Preserve the caller's selected final review cadence;
this method creates no additional review checkpoint.

## Record

```text
gate: requirements-engineer/quality-gate
candidate_id: <id>
checklist: <method checklist name>
verdict: PASS | FAIL | TYPED_GAP | BLOCKED
typed_failures: <codes or none>
typed_gap: <code or none>
rows:
  - id: <checklist row id>
    result: PASS | FAIL | N/A
    typed_failure: <code or none>
    evidence: <observable>
    na_reason: <reason or none>
```

## Typed gaps (not gate failures)

| code | request | owner |
| --- | --- | --- |
| TYPED_GAP_PERSISTENCE | write, revise, validate, review, or publish the register | the register host workflow |
| TYPED_GAP_MODEL | choose a model or harness | the lifecycle controller |
| TYPED_GAP_TEST_CODE | write product tests | the Test Engineer |

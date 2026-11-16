# Verification case fields

Planning and execution case record for the Test Engineer. These are case
fields, not a hook path or receipt schema. Do not add receipt bytes, outcome
JSON, or harness locations here.

## Required on every case

| field | rule |
| --- | --- |
| id | Stable case identity |
| kind | `verification` or `validation` |
| requirement_id | Allocated requirement or risk |
| method | Exactly one of `analysis`, `inspection`, `demonstration`, `test`, `evaluation` |
| observable_evidence | What will be collected; required |
| pass_fail_rule | Evaluable PASS/FAIL statement; required |
| stimulus_or_procedure | How the method is applied |
| expected_result | Observable success |
| negative_or_failure_case | What fails the case |

## Expected results and independent oracles

An oracle is the independently justified basis for expected behavior. Identify
its source in the existing `expected_result` or `pass_fail_rule` text; use
`negative_or_failure_case` to name a plausible wrong behavior the case rejects.
This guidance adds no schema or receipt fields.

Use a requirement, specification, independently worked example, published
constant, external contract, or independently justified property. Computed
expectations are valid when that basis is independent. Calling the production
helper to calculate its own expected result, or copying its formula without
independent justification, is circular. Missing justification remains an
evidence gap; do not invent a requirement or expected value to fill it.

For executable tests, exercise an interface and assert observable behavior,
state, output, effects, or failure. Finding implementation strings, tokens,
AST shapes, or incidental snapshots does not prove that behavior. This does
not prohibit source inspection under an allocated inspection or analysis method.

Preserve legitimate contracts where text or bytes are themselves the product:
generated public output, serialized protocols, persisted state, or an explicitly
owned snapshot. Name the contract and check its actual output. For declarative
configuration, use the real consumer when feasible; otherwise parse a typed or
normalized semantic model and assert its meaning, rather than raw substrings.
Constants, snapshots, and external-boundary mocks remain valid when they check
an independent contract and meet the existing input/dependency evidence rules.

For useful existing tests with circular expectations or source proxies, repair
the expectation from independent evidence before considering pruning. Preserve
valid coverage and independently authored tests; respect the assigned write set.
If repair lacks evidence, report the gap and any authorized deletion with its
reason. Do not invent values or silently remove the only check of required behavior.

For agent instructions, a deterministic check of the final emitted prompt can
verify its intentional text interface. It cannot establish that a model obeys
it; when interpretation matters, evaluate it with matching/non-matching forward
tasks during development. This introduces no live-model CI requirement or extra review round.

Adapted from the [no-mistakes test-quality guidance](https://github.com/kunchenguid/no-mistakes/blob/ce5376cf90cffc0e8e20070bccc319475609d94d/skills/no-mistakes/SKILL.md#test-quality-rule).
The existing method allocation, authorship, coverage and authority rules apply.

## Coverage reuse

Before adding coverage, inventory cases, fixtures, harnesses, and gate
membership against the missing contracts. Extend or parameterize the closest
coverage first and justify a new test by a distinct observable contract.
Preserve valid coverage; never optimize test count. Report extended, new,
replaced and deleted cases with reasons.

## Also record when known

`design_id`, `command_id`, `boundary`, `layer`, `level`, `integration_steps`,
`preconditions`, `expected_state`, `expected_side_effects`,
`security_and_adversarial`, `execution_readiness`.

## Method-specific evidence fields

Fill only the block that matches `method`. Non-test blocks must not name a
product test path.

| method | fields | product test path |
| --- | --- | --- |
| analysis | `analysis_object`, `analysis_technique`, `analysis_product` | none |
| inspection | `inspection_article`, `inspection_criteria`, `inspection_record` | none |
| demonstration | `demonstration_scenario`, `observed_behavior` | none |
| test | `test_article`, `stimulus`, `measured_response`, `test_environment` | the Test Implementer authors the executable test after the Test Engineer selects `test` |
| evaluation | `evaluation_subject`, `intended_use`, `evaluator` | none |

## Branches

- If `method` is `test`, stop authoring Test Engineer case fields and hand executable-test
  work to the Test Implementer. The Test Engineer does not become the test-writing method.
- If `method` is not `test`, produce the method-specific evidence only.
- If no observable behavior changed, `NO_TEST_REQUIRED` may close the case.
  If observable behavior changed, `NO_TEST_REQUIRED` is invalid.
- Ambiguous ownership of a diff returns `UNAVAILABLE`.
- Model choice returns a typed gap.

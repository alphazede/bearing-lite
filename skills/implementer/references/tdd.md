# TDD regression sequence

Use after [Integration and Test](../../integration-test/SKILL.md) selects `test` (or [Test Engineer](../../test-engineer/SKILL.md) in assurance).
The frozen assignment decides combined or separate authorship; this sequence
never changes roles, models, capabilities, or review cadence.

1. Name the intended observable behavior and smallest real reproduction.
   Classify preparation, environment, harness, and expected-negative failures
   before treating an observation as a product defect.
2. Inventory existing cases, fixtures, callers, and gate membership. Extend
   the closest useful coverage; justify a new case only for a distinct contract.
3. Before product repair, run that case against the identified unfixed revision.
   Record case IDs, input/fixture identity, command, and observed failure.
   A collection error, missing service, timeout, or unrelated assertion is not
   the intended red result. A passing case does not establish regression proof.
4. Give the failure evidence to the authorized product author. Repair the
   shared cause while preserving nearby behavior. Do not write a batch of
   speculative tests before learning from the first real failure.
   A guard, retry or clamp is a repair only when the state it handles is
   legitimate; otherwise trace what produced that state.
5. Run the same case IDs and inputs on the repaired candidate. Compare the
   failed assertion with the passing response; run applicable neighboring valid,
   negative, compatibility, and integration cases. Refactor only within scope,
   retaining passing coverage. Do not change assertions to bless a wrong result.
   Confirm the repair on the surface where the defect was seen; a unit test
   passing elsewhere does not close a user-path defect.
6. Report red and green revisions, case IDs, commands, observed results,
   unchanged inputs, prevention, resource group, and applicable qualification.
   Preserve the original red evidence if a later attempt exposes a different cause.

Before keeping a test, picture two edits to the code under test. If a wrong
value or a skipped or doubled effect would still pass, tighten the test. If a
refactor that keeps every observable result would fail it, the test is pinned
to the implementation.

For separate authorship, pass a compact case/evidence handoff between the
selected test and product authors; do not authorize either to write the other's
paths. Serialize that feature's red/repair/green sequence. Independent features
may progress concurrently within the selected capacity and resource constraints.

If an executable regression is impractical, describe the exact missing fact
or resource to Integration and Test (planning) or the Assurance Test Engineer, which may allocate another justified
V&V method under existing authority. A source inspection or manual reproduction
can provide useful evidence, but does not satisfy a required executable red/green
claim. Keep that gap visible; cost alone never cancels required proof or security coverage.
Never add brittle mocks, timing guesses, or production-only dependencies to
make the workflow appear complete. Also reject a test that depends on unrelated
global state, needs expensive infrastructure for a small fix, or would be
deleted once the fix lands. Extend the closest existing test before adding one.
For every bug, require red for the intended reason, then green on the same
case IDs, using that closest good test. When a good committed test is
impractical, the same unchanged executable script run red before the fix and
green after it satisfies that regression requirement.

Write every expectation from the allocated oracle source. Never reimplement
the production algorithm or mirror production logic to compute the expected
result; assert the observable behavior the oracle predicts.

Use the existing evidence-driven correction bound. A flaky result needs
a new causal hypothesis and deterministic signal; repeating it until green is
not a repair. After two failed corrections that share one assumption, write
the assumption down and test it before a third attempt. When a check fails,
suspect the observation method before the system. Script the check so it
reruns with its output visible. An input-hash-matched cached PASS labelled
cached is identity evidence, not a proxy. Retain all required reliability
runs from the Test Engineer.

Stay correct on a shared, loaded machine per
[shared-machine tests](../../test-engineer/references/shared-machine-tests.md).

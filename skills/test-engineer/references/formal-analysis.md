# Formal analysis

Use this optional analysis path when a named requirement or intended-use risk
calls for invariant, ordering, safety, or exhaustive-input reasoning. It adds
no universal PR gate and no extra role, and grants no exemption from repository
tool-acquisition policy. The Test Engineer owns the [V&V case](verification-case.md)
and evidence; the Systems Modeler retains semantic modeling authority.

## Select one question

Use the requested area. If none is named, inventory consequential promises in
the authorized scope and choose one whose failure matters and whose behavior
existing tests cannot adequately explore. Record the property and user harm
in plain language. Explain the choice; list other targets as unverified.
Do not expand into a repository-wide proof campaign.

Select a reproducible tool that fits the question and cost; reuse installed
harnesses first and follow repository supply-chain policy for acquisition:
state-space exploration for interleavings, code-level verification for input
and memory properties, or a proof assistant when finite bounds cannot support
the claimed generality. No language-specific verifier available means
`UNAVAILABLE` for that proof. Generated-input testing of the real implementation
may be a separate `test` case handed to the Test Implementer; never label it
a formal proof. Do not silently switch the allocated method. Distinguish missing
evidence (`NEEDS_EVIDENCE`), unavailable tooling (`UNAVAILABLE`), and an
authority or preparation blocker (a typed gap). Read-only analysis needs read
authority; writing artifacts and scratch mutations need write authority.

## Record correspondence and rerun procedure

Extend existing verification assets with one repository-local procedure,
using established discovery conventions. Reuse the existing case and
coverage records rather than duplicating requirements. Include:

- Requirement/property, harm, tool identity/version, exact command, inputs,
  expected result, runtime, and retained evidence location.
- Covered source files/functions and corresponding model or proof elements;
  state, transitions and atomicity grounded in actual implementation steps.
- Explicit environmental assumptions, finite bounds, omissions, and whether
  the result concerns a model, a bounded implementation, or an unrestricted claim.
- The candidate revision/input digests and last revision at which someone
  confirmed that the abstraction still describes the implementation.

On a relevant code change, inspect correspondence before advancing that
confirmed revision and rerunning. A solver pass on a stale abstraction is not
candidate evidence. Intended behavior changes follow existing requirement and
design authority; do not weaken properties to obtain a pass.

## Exercise and interpret

Run the documented procedure, preserve its baseline result, then exercise an
isolated scratch mutation in the real covered code that violates the property.
For a code-level verifier, retain the failed check on that implementation.
For a separate model, detect the correspondence change, faithfully reflect
the broken implementation step in the model without changing the property,
and retain the checker counterexample. Merely noticing drift or mutating a
detached model does not establish that the property check can fail. Never
advance the confirmed revision without inspecting that relationship.

Restore only owned scratch changes and rerun the original candidate; preserve
both failure evidence and the restored baseline. An initially failing baseline
can remain failing for the same documented finding. Never erase it or modify
product behavior without authority. A procedure not exercised this way remains
`NEEDS_EVIDENCE`. Use the existing evidence-driven correction bound and
stop without a new hypothesis; clean owned scratch resources after failures.

Distinguish a real implementation violation from a faulty abstraction,
unsupported assumption, bound exhaustion, timeout, or tool/environment error.
Explain a counterexample as source-level actions in order. Correct a modeling
error only with code evidence; a product violation follows the repository's
bug-triage route within existing authority. A timeout or incomplete search is
not a proved property. Use the existing outcome vocabulary.

## Handoff and maintenance

Hand off the scoped result, counterexamples, assumptions, bounds, covered-code
map, confirmed revision, commands, runtime, evidence and remaining gaps.
The Integration Engineer carries applicable artifacts with its candidate;
independent checks verify their applicability. A landing review inspects the
claim and candidate binding under its existing validation policy. Neither
assembly nor a formal model pass establishes whole-system assurance.

For state-based results, include an intelligible trace or state diagram when
it helps interpretation. Do not depend on an uninstalled peer plugin or copy
its machine-specific commands. Maintain the correspondence record when code
changes; no new maintenance skill or recurring schedule is required.

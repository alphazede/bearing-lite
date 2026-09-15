# Parallel review capability

Decision source: issue #104.

`hooks/review-capability.cjs` is the runtime evaluator of this contract. It
declares no hook class and registers no host event. Like the verification
adapter it never downloads, installs, or invokes anything: the caller runs the
planned command.

A capability is a tool the Reviewer invokes. It is never a role, never an
authority source, and it never produces the verdict. This module returns
findings; the Reviewer returns the result.

## Why two paths

Coverage, file selection, review order, and attention are all mediated by one
model and one session, so a single reviewer misses things a different mechanism
catches. The risk runs the other way too. Findings read before the Reviewer has
formed its own anchor it, and the independence that made the second path
worth adding is spent.

## Ordering

The order is enforced by a digest, not by good intentions.

1. The Reviewer receives the exact candidate and the approved artifacts.
2. `planReview` returns the invocation, bound to the candidate diff base and
   revision. The caller launches it.
3. The Reviewer reviews independently while that runs.
4. `freezeFindings` seals the Reviewer's own first pass and binds a SHA-256
   over the findings alone. Order and key order do not change the digest; a
   changed finding does. An empty first pass is a real result and freezes
   normally.
5. Only then are the capability's findings read.
6. `reconcileFindings` merges them. It refuses a first pass that was never
   frozen (`first_pass_not_frozen`), one whose contents no longer match its
   digest (`frozen_findings_digest_mismatch`), and one bound to a different
   candidate (`candidate_mismatch`).
7. Deterministic verification may check a material factual claim after
   reconciliation. A Reviewer's own run is `diagnostic` authority; only an
   independent Test Engineer assurance session produces `assurance`.
8. The Reviewer emits the single authoritative result.

A test can prove the frozen set existed and is unaltered. No test can prove a
reader did not look early, which is why the digest, not the instruction, is the
mechanism.

## Provenance

Findings are matched by location. Each carries `reviewer`, `capability`, or
`both`, and `counts` totals the three. A location both paths reported keeps the
capability's summary alongside the Reviewer's.

Severity disagreement is surfaced, never resolved silently: `severity_conflict`
is true, `severities` records both, `conflicts` lists them, and the Reviewer's
severity stands until the Reviewer adjudicates it.

## Activation

`review.parallel_review.enabled` means the route is available, not that every
review dispatches it. An explicit disabled choice is allowed and is not a gap.

| State | Result |
|---|---|
| neither enabled nor required | `INACTIVE` / `capability_unselected_unrequired` |
| enabled or required, unavailable | `UNAVAILABLE` / `typed_capability_gap` |
| enabled or required, available | `READY` with the planned invocation |

An activated capability that cannot run is a typed gap. Never report equivalent
coverage from the remaining path.

## Configuration

The capability carries its own provider and model configuration, set by its own
tooling. Bearing Lite records only whether it is enabled and required, and never
selects credentials, providers, or models. `profiles.json` routes Bearing roles;
it does not route a tool.

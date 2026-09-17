# Review coverage assist

Decision source: issue #104.

`hooks/review-capability.cjs` is the runtime evaluator of this contract. It
declares no hook class and registers no host event, and like the verification
adapter it never downloads, installs, or invokes anything. The caller runs the
planned command.

A capability is a tool the Reviewer uses as its method. It is never a role,
never an authority source, and it produces no findings and no verdict. The
Reviewer does both.

## What it is for

Coverage, file selection and review order are mediated by one session, so a
Reviewer can miss a file or bring the wrong lens to one. A deterministic
capability fixes that half cheaply: reviewable files, exclusions with reasons,
and the rules that apply to each.

It is not a second opinion. There is one detection path, so there is no separate
findings set, nothing to anchor on, and nothing to reconcile. A second reviewing
model would overlap the Assurance Test Engineer and Integration Engineer
execution passes that already follow.

## Declared, never discovered

The parent controller resolves availability once and states it in the packet.
It copies `enabled` and `required` from the frozen Lifecycle snapshot's
`review.coverage_assist`, never from the live catalog. It resolves
OpenCodeReview (OCR) identity and host availability explicitly: the packet
names OpenCodeReview as `capability`. If that identity or availability
cannot be resolved, declare `available: false` and return a typed gap. A
generic capability name must not stand in for an absent OpenCodeReview
binding. `planCoverage` requires a complete declaration of `enabled`,
`required` and `available`; an incomplete one returns
`capability_not_declared` rather than falling back to a probe. A Reviewer
that discovers its own tooling spends a turn on plumbing before reviewing
anything, which is the cost this avoids.

| Declared state | Result |
|---|---|
| neither enabled nor required | `INACTIVE` / `capability_unselected_unrequired` |
| enabled, not required, unavailable | `UNAVAILABLE` / `typed_capability_gap`, `proceed: proceed-with-note` |
| required (with or without enabled), unavailable | `UNAVAILABLE` / `typed_capability_gap`, `proceed: halt` |
| activated, available | `READY` with the planned invocation |

`enabled` means the role may proceed with a recorded note. `required` means the
role may not proceed without the capability (halt). Both stay typed gaps when
unavailable. An omitted `required` on a legacy profile is false; there is no
migration. An explicit disabled choice is allowed and is not a gap. An activated
capability that cannot run is a typed gap; never report equivalent coverage from
what remains.

## Sequence

1. `planCoverage` returns the invocation, pinned to the candidate's diff base
   and revision. The caller runs it.
2. `summarizeCoverage` reads the report: reviewable paths, and exclusions with
   the reason each was skipped.
3. `planRules` returns the rule invocation for exactly those reviewable paths,
   and `INACTIVE` with `no_reviewable_files` when there are none.
4. The Reviewer reviews, with the rules in hand, and returns the verdict.

## The file list is advisory

`summarizeCoverage` always reports `coverage_is_advisory: true`, and it lists
every exclusion with its reason. A file the Reviewer never learns was skipped is
one it cannot choose to read.

This matters where a repository's own content falls outside a capability's
default file types. A tool that treats documentation as unreviewable is right
for most repositories and wrong for one whose product is its documents. Supply a
repository ruleset through `rule_file` in that case, and read the exclusions
regardless.

## Cost

The rules are not free: they enter the Reviewer's context. The saving is the
excluded files and the ordering, so the balance depends on the diff. A large
change carrying generated files, lockfiles or vendored code gains. A small,
clean change pays the rule cost with little to exclude.

## The two halves are independent

`planCoverage` and `summarizeCoverage` give the file list and the exclusions at
near-zero token cost; `planRules` is a separate call, so a caller may use the
coverage half and skip the rules entirely. On a real 14-file diff the rule
payload was 19,134 bytes, roughly 4,784 estimated tokens, and the rules are
generic code-quality rules that can pull a plan-drift reviewer toward style
nits. The adopter decides which halves to use.

## Configuration

`review.coverage_assist` records `enabled` (required in the schema) and optional
`required` (legacy omission is false). Nothing else. The capability keeps its
own configuration in its own tooling, and Bearing Lite never selects
credentials, providers or models for it.

Per-harness host readiness (binary on PATH, Cursor allowlist) is owner-machine
configuration. It folds into issue #92 plugin-install testing, not this repo.

# Review coverage assist

Name OpenCodeReview (OCR) explicitly; a generic capability name must not stand in
for an absent tool binding. Read selected settings from the frozen Lifecycle
snapshot, never from the live catalog.

The Reviewer owns capability preparation, selection and execution for one requested
review. The controller supplies the exact candidate, objective, authority and frozen
`review.coverage_assist`/execution-mode requirements. Tool availability and commands
are resolved by the Reviewer once, not guessed or pre-executed by the controller.
No new reviewer, assurance round, install or authority follows from tool selection.

## Bind one wave or phase

Record repository, unit ID, approved wave base, exact head SHA, effective merge-base,
PR number when applicable, and candidate digest. Resolve moving refs once; preserve
that snapshot throughout review. For a PR, obtain its base/head object IDs with
`gh api repos/<OWNER>/<REPO>/pulls/<PR> --jq '{base_sha: .base.sha, head_sha: .head.sha}'`;
reconcile them with the approved wave boundary. The PR base does not silently
replace a prior-wave baseline. Range mode
uses merge-base semantics: record `git merge-base "$BASE_SHA" "$HEAD_SHA"` and the
resolved range from OCR's report. Stop on an unexpected or moving head. A commit
review covers one commit only, never an entire multi-commit wave by implication.

## Reviewer preflight and scope

Read the selected mode and capability flags from the frozen binding, not the live
catalog. Resolve the existing configured provider that supports the selected model
and effort without accessing credential values or changing global configuration.
Do not silently choose the tool's default model or a different provider/model.
Missing support is a typed capability gap; recovery uses existing owner authority
and preserves spent calls/rounds. No automatic model sampling or retry loop.

Preview without a model call, then inspect every selected/excluded path and its
reason. Own-engine output can contain proposed findings; the Reviewer validates
them against current source and safe reproducers and owns the final verdict.
Delegation output supplies selection/rules, not independent detection. Mode changes
require authority; delegation never substitutes for selected own-engine coverage.

Preserve required changed-source coverage and applicable ordinary/security rules.
Avoid repeatedly sending historical receipts, superseded drafts, raw transcripts
or duplicate generated evidence only when its canonical source and verification
or manual review account for the omitted material. Generated executable code,
lockfiles and required evidence are not automatically exempt. Honor stricter
repository coverage rules; do not silently weaken an all-supported-files policy.
Read unsupported Markdown/SDoc and other material yourself when required. An OCR
exclusion is advisory, never proof that a file is irrelevant. Do not discard a
measured finding solely because it came from a generated file.

## Complementary work, one verdict

Scope OCR to introduced bugs and security defects in the exact wave's changed
code, tests, behavior-affecting configuration and dependencies, plus necessary
call-path context. The Reviewer assesses architecture, approved plan/requirements,
implementation conformance, verification/validation evidence and lint/quality tools.
Keep required bug/security rules; use manual coverage for unsupported surfaces.
Do not feed every plan, historical receipt or generated evidence file into OCR merely
because it appears in the range. The Reviewer still accounts for that material.
Required security context belongs in OCR's inputs when needed to trace a defect;
a narrow diff is not permission to omit affected trust boundaries.

Start the bounded own-engine invocation and retain its native completion handle.
While it runs, perform the complementary work on the same stable candidate;
use completion notifications, not log polling or another review agent. Reuse applicable
passing checks. Wait for OCR and all declared inputs before freezing consolidated
findings or modifying the candidate. Validate OCR findings, deduplicate and inspect
specific coverage gaps; do not repeat its complete bug/security pass from scratch.
Continue directly into the preauthorized same-session repair when applicable.

## Commands (run from the candidate repository)

The Reviewer selects the applicable form; these are alternatives, not a checklist.
Resolve placeholders before execution. Own-engine calls explicitly pass the frozen
reviewer provider, model and effort; repeat the same selection and exclusions when
resuming. Save JSON evidence in the assigned review directory. Check installed CLI
help only when a required flag is uncertain; no tool installation is implied.

```bash
cd "$REPO"
# Requested uncommitted-workspace review only; bind all selected file digests.
ocr review --preview
ocr review --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"

# Whole wave: pinned approved base and exact head, not moving branch names.
git merge-base "$BASE_SHA" "$HEAD_SHA"
ocr review --from "$BASE_SHA" --to "$HEAD_SHA" --preview --format json
ocr review --from "$BASE_SHA" --to "$HEAD_SHA" --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"

# Only when the requested unit is exactly one commit.
ocr review --commit "$HEAD_SHA" --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"

# Authorized recovery of the same review; no new round or reset allowance.
ocr session list --repo "$REPO" --json
ocr review --from "$BASE_SHA" --to "$HEAD_SHA" --resume "$OCR_SESSION_ID" --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"

# Full-file scan only for explicitly requested full-file scope.
ocr scan --path "$APPROVED_PATHS" --preview
ocr scan --path "$APPROVED_PATHS" --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"
ocr scan --path "$APPROVED_PATHS" --resume "$OCR_SESSION_ID" --provider "$PROVIDER" --model "$MODEL" --effort "$EFFORT" --format json --output "$RESULT"
# Omit --path only when the owner requested the entire repository.

# Delegation mode ONLY when selected; no own-engine model call.
ocr delegate preview --from "$BASE_SHA" --to "$HEAD_SHA" --format json
ocr delegate rule src/main.go src/handler.go
```

Use exact repo-relative rule paths from the preview, not the illustrative filenames.
Add `--exclude "$EXCLUSIONS"` only after the coverage rationale above, and carry it
unchanged into the recorded/resumed invocation. Workspace mode is not a fallback
for a clean committed wave; scan is not a fallback for an expensive diff. Record
reported input/output/cache tokens, selected file count and elapsed time when the
tool provides them; do not invent a token budget or claim measured savings before
comparable runs exist. Token totals are not a verified billing charge.

## Existing deterministic adapter

`hooks/review-capability.cjs` remains a pure evaluator: no host hook, downloads,
installs or subprocesses. It models delegation selection/rules, not own-engine
execution. The Reviewer supplies its resolved declaration before using it; no
adapter change or new guard is introduced by this procedure.

`planCoverage` requires `capability`, candidate ref/revision/diff_base, and explicit
`declared.enabled`, `required`, `available`. Normalize omitted legacy `required`
to false. Missing declarations return `capability_not_declared`; the adapter does
not probe. `summarizeCoverage` retains exclusions/reasons and advisory coverage;
`planRules` selects rules for exactly the reviewable paths. Empty selection is
`INACTIVE/no_reviewable_files`, not proof of complete review.

| Declared state | Result |
| --- | --- |
| Neither enabled nor required | INACTIVE; no capability invocation |
| Enabled only, unavailable | UNAVAILABLE typed gap; proceed with note |
| Required, unavailable | UNAVAILABLE typed gap; halt |
| Activated and available | READY for the selected mode's bounded invocation |

Tool configuration remains outside Bearing's public profiles. Preserve Reverify
applicability and spent review/repair budgets; ordinary tests never replace it.

# Replay benchmark

Compare lifecycle variants on one frozen workload, then decide promotion with
`tools/promotion-rule.mjs`. The tool returns a report. It does not change a
default, a profile, a receipt, or a gate.

The public report names the private test-engineering benchmark-evidence method
for any benchmark number. Participation in a published report is by role only.
Do not publish a model name or a harness name.

## Freeze the workload

Record the workload digest before the first run. Every variant and every
repetition uses that digest. Freeze each variant package and record the sha256
of that package before the runs. A run whose package digest changes, or whose
workload digest differs, is not a comparison.

Record the input hashes and state the coverage gaps. A baseline that omits a
gap is not reproducible.

Variants A, B, C, and D stay on that same workload and those frozen packages.
Do not add a required local backend arm or an alternate hosted backend arm.
EGM-inspired checks run only inside an existing owner-requested review. Do not
add a review slot, a role, or reviewer fan-out.

## What each run records

One JSON receipt per run. Pair runs by `task` and `repetition`.

Required fields: `workload_digest`, `task`, `repetition`, `package_digest`,
`gates` (`PASS` or `FAIL` per gate), `seeded_defects` (found `true`, missed
`false`), `violations` (`authority` and `write_set` counts), `fresh_tokens`,
`integrated_slices`, `errors`, `elapsed_ms`, and `owner_asks`.

`route` may stay on the private receipt. The promotion report does not copy
it.

Also record, per variant, the measures the comparison claims:

- Replay: tokens per integrated slice, tokens per completed journey, planning
  quality, correctness, review defect detection, assurance independence, owner
  interruptions, elapsed time, retries, specialist-call rate, and agent idle
  time including inference overhead, plus cache effects, errors, and rework.
- Prompt changes, across short, medium, and complex tasks in planning,
  implementation, review, and assurance: prompt tokens, total journey tokens,
  latency, tool calls, correctness, evidence coverage, rework, and reviewer
  findings. Reject an optimization that omits necessary task context, changes
  authorization, or increases hallucinations.
- EGM inside the existing planning review: ambiguity defects caught, false
  positives, implementer clarification and rework, review tokens, total
  journey tokens, and elapsed time.
- Pstack-derived changes: total tokens, latency, errors and rework, test
  effectiveness, review findings, and completed tasks.
- Orchestrator replay on the same recorded planning session: model-call count
  and cache-read tokens, with stage input, cache-write, cache-read, and output
  counts from the host session log.
- Dispatch classification, on the same owner-labelled packets: keyword,
  decision-assisted, and combined arms, each with classification errors,
  fresh tokens, elapsed time, and owner-ask rate.

Candidate order for decision types is dispatch classification, then post-run
trace review, then pre-packet sharpen. The four restricted types (mid-task
evidence sufficiency, failure classification, owner stop, and review
prioritization) use fact-only state. Measure pre-packet objective and
acceptance judgments on real packets before trusting that check.

Apply a probability threshold only after calibration on owner-labelled cases
that include fact-preserving adversarial cases. When an arm requires
`calibration` or `egress` evidence, put it on the receipt. Absent required
evidence is not a pass. Unqualified calibration is not a pass. Never log a
backend key. Dispatch-packet text may be sent as written, and only as
untrusted state, for dispatch classification.

## Promotion

Put each arm's receipts in its own directory, one `*.json` file per run.

```
node tools/promotion-rule.mjs --baseline <baseline-dir> --candidate <candidate-dir>
```

Exit 0 prints one JSON report for both `promote` and `no_promote`. The report
lists `decision`, `reasons`, the four terms, per-arm run count, median fresh
tokens per integrated slice, errors, elapsed time, and owner asks, and
`recommendation`.

DEC-07, evaluated per `(task, repetition)` pair: every gate that passed in the
baseline still passes; every seeded defect the baseline found is found; the
candidate has no authority or write-set violation; and the candidate median of
`fresh_tokens / integrated_slices` is lower. A baseline failure does not
excuse the candidate. Equal medians do not promote. A missing pair, gate,
defect, or metric is `missing_evidence` and does not promote.

`promote` recommends `adopt_candidate` and has an empty reason list. Any
quality regression, incomparable workload, unqualified calibration, or missing
evidence is `no_promote` and `keep_current_default`. The current default stays
until a `promote` report exists. A compiler, an EGM technique, a
decision-backend default, or a Pstack-derived default changes only on that
report. Promise no savings the replay did not measure.

Roll back an adopted default with the recorded last-good config and package.
Do not restore old task budgets. Keep the replay receipts.

## CHECK-B30-418

A benchmark number in the report is valid only when all of the following hold.
These are requirements, not a sample result.

- The report states a written decision claim, including the result that would
  change the decision.
- The report states a measured limiter taken from a profile, not from reading
  source. It reports that limiter, the median, the range, and end-to-end
  relevance.
- The report states the production tuning in effect for the measured runs.
- The report uses five alternating runs per side.
- The report is inconclusive when spread exceeds effect or the limiter is
  unknown.
- Counted errors are reported. Arithmetic is checked against the hardware
  limits. The report shows that the measured work ran inside the timed region.

## Report template

Fill every field from the receipts and the promotion JSON. Leave a field
empty rather than inventing a value.

- Decision claim:
- Result that would change the decision:
- Workload digest:
- Package digest per variant (sha256 recorded before the runs):
- Coverage gaps:
- Limiter (profile source):
- Production tuning:
- Five alternating runs per side (median and range):
- Spread versus effect (inconclusive or not):
- Errors:
- Timed-region proof:
- Hardware-limit check:
- End-to-end relevance:
- Promotion command and exit code:
- Decision, reasons, terms, recommendation:
- Per-arm runs, median fresh tokens per integrated slice, errors, elapsed
  time, owner asks:
- Measures from the list above that this comparison claims:
- Rollout criteria:
- Rollback (last-good config and package; task budgets unchanged):
- Measured savings only:

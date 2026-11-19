# Planning handoff template

Run `node <plugin root>/hooks/plan-package.cjs <plan dir>` and write `handoff.md`
in the confirmed plan directory after the final freeze passes. Record the JSON
result with the command and its exit code.

```markdown
# Planning Handoff

- candidate_ref: <repository/plan reference>
- candidate_revision: <revision or HEAD>
- worktree: <checkout/worktree path>
- plan_dir: <checkout-relative plan directory>
- final_freeze_receipt:
  - command: node <plugin root>/hooks/plan-package.cjs <plan dir>
  - stage: final
  - outcome: PASS
  - manifest_digest: <64-hex sha256 from final freeze>
  - findings: []
  - exit_code: 0
- artifacts:
  - <plan_dir/technical-plan.md>: <sha256>
  - <plan_dir/design.md>: <sha256>
  - <plan_dir/seit.json>: <sha256>
  - <plan_dir/implementation.json>: <sha256>
  - <plan_dir/dod-manifest.html>: <sha256>
- scope: <confirmed scope and boundaries>
- decisions_and_authority: <confirmed owner decision IDs and authority envelope>
- profile_snapshot: <frozen selected models/harnesses/capabilities>
- assignments_and_write_sets: <dependency-ordered waves/slices, roles, write sets>
- commands_and_evidence: <commands, exit codes, and digests — not narrative logs>
- review_status: <planning review outcome or review_requested: false>
- blockers: <none | open blockers>
- next_action: <first implementation wave/slice dispatch>
```

At intake, the Implementation Orchestrator checks `stage: final`, `outcome: PASS`,
and `exit_code: 0` on the structured receipt. Compare `manifest_digest` with
`journey_settings.planning_review.candidate_digest` in the handoff's
`implementation.json` and verify the recorded artifact hashes against their files.
If the receipt is absent or any check fails, return to planning before dispatch.

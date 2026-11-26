# Planning handoff template

Run `node <plugin root>/hooks/plan-package.cjs <plan dir>` and write `handoff.md`
in the confirmed plan directory after the final freeze passes. Record the JSON
result with the command and its exit code.

```markdown
# Planning Handoff

- verdict: READY
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
- manifest_delivery:
  - path: <plan_dir>/<dod_manifest.output_name>
  - sha256: <64-hex sha256 of rendered DoD Manifest HTML>
  - opened_in: <browser used to open the Manifest, e.g. Chrome>
  - delivered_at: <UTC timestamp>
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
- changed_paths: <exact paths changed during planning>
- tests: <commands, exit codes, and evidence digests, including the final freeze>
- findings: <finding IDs and their disposition, or none>
- target_host_delivery:
  - candidate_transport: <how the exact candidate and its proof travel to each target host, or none>
  - transport_approval: <who may approve that transport (owner or explicit delegate within authority.json), or none>
  - local_landing_when_host_gate_unavailable: <what may land locally vs what stays held when the host gate cannot run, or none>
- review_status: <planning review outcome or review_requested: false>
- blocker: none
- next_action: <first implementation wave/slice dispatch>
```

At intake, the Implementation Orchestrator checks `stage: final`, `outcome: PASS`,
and `exit_code: 0` on the structured receipt, plus `manifest_delivery.path` and
`manifest_delivery.sha256` against the current answered Class E confirmation
and rendered Manifest. Copy the delivery evidence from that confirmation;
the handoff is not a substitute for it.
Compare `manifest_digest` with
`journey_settings.planning_review.candidate_digest` in the handoff's
`implementation.json` and verify the recorded artifact hashes against their files.
If the final freeze receipt or Manifest delivery record is absent or a receipt check
fails, return to planning before dispatch. Do not invent evidence for an older
handoff that lacks a delivery record.

When scheduling work on a target host, use `target_host_delivery` to identify
how the exact candidate and its proof travel to the target host, who may approve
that transport, and what may land locally when the host gate cannot run.

---
name: prompt
description: Write a bounded execution prompt for another agent. Use for handoff authoring. Do not use to execute tasks.
type: agent-skill
title: Write Agent Handoff
okf_status: active
tags:
  - internal
  - skills
---

# Write Agent Handoff

Write one verifiable responsibility using these sections in order.

## ROLE
Name one role and responsibility; exclude other roles' work.

## STATE
Separate facts from assumptions; include available paths, revisions, commands, identifiers, and unresolved failures. Omit cheaply retrievable context.
Name each touched trust boundary with its invariant, or state "none".

## OBJECTIVE
Define one observable outcome and a numbered acceptance list.

## AUTHORITY
List allowed paths and prohibited changes. Preserve controlling authority.
Never invent permissions, budgets, deadlines, or reasoning levels; specify reasoning only when explicitly owner-directed, otherwise use the configured default.

## TIME BUDGET
Every handoff carries one TIME BUDGET line: session budget and per-external-call bound smaller than remaining session time. Stop new work at T minus 5; write the result.

## LOOP
Observe → hypothesize → perform allowed role work → verify → classify failures → report.
Allow at most three correction rounds; retry only with new evidence or hypothesis.

## VERIFY
Name the repository gate first (required CI checks, documented script, or CONTRIBUTING command); require its exit code. Omitting it is incomplete; supplemental criteria never replace it.
Require observable acceptance evidence, one negative check per named boundary, preserved valid behavior, and write-set checks. For repairs, require failing-before/passing-after evidence.

## RETURN
Require one outcome: PASS, REPAIRABLE_FAILURE, CONTRACT_FAILURE, ENVIRONMENT_FAILURE, NEEDS_MORE_EVIDENCE, or OWNER_DECISION_REQUIRED.
Require an acceptance-to-evidence table with one row per item: item, proving test or observation, result. PASS is invalid while any row is unmet or unmapped.
Include changed paths, commands executed, evidence, remaining risks, and blocker.

## STOP
Stop when proven, authority is insufficient, the contract cannot be satisfied honestly, evidence is unavailable, or an owner/architecture decision is required; difficulty alone is insufficient.

## Fan-out (optional)
For independent questions, declare N same-role child sessions maximum, one per question. Each receives this format, its own write directory, inputs, and its own TIME BUDGET. Write directories must be distinct.
Children inherit lead authority and stop only through their own session handle. The lead only launches, waits, and merges typed returns into one artifact; mark missing answers unanswered. Add no findings beyond the merge.

---
name: prompt
description: Write a bounded execution prompt for another agent.
type: agent-skill
title: Write Agent Handoff
okf_status: active
tags:
  - internal
  - skills
---

# Write Agent Handoff

Create the smallest prompt that allows one agent to perform one responsibility and return verifiable evidence.

## Structure

Use only these sections:

```text
ROLE
STATE
OBJECTIVE
AUTHORITY
TIME BUDGET
LOOP
VERIFY
RETURN
STOP
```

## ROLE

Name one agent role.

State what that role is responsible for.

Do not give the agent responsibilities owned by another role.

```text
ROLE
Product Implementer

RESPONSIBILITY
Implement one approved slice.
```

## STATE

Describe the current known state.

Separate facts from assumptions.

```text
STATE
Phase: Authentication
Slice: AUTH-3
Status: ready
Baseline: commit abc123
Current failure: unauthorized paths are accepted
```

Include exact paths, revisions, commands, identifiers, and unresolved failures when available.

Do not paste information the agent can retrieve cheaply.

Name each touched trust boundary with its invariant, or state "none". Examples of boundaries: caller input, operator configuration, authentication, filesystem paths, merge or publication gates.

## OBJECTIVE

Define one observable outcome.

```text
OBJECTIVE
Reject unauthorized paths without changing valid-path behavior.
```

The objective should describe the result, not vague activity such as “investigate” or “work on.”

Follow it with a numbered acceptance list: each item is one observable condition the result must meet.

## AUTHORITY

Define what the agent may and may not change.

```text
AUTHORITY
Allowed paths:
- src/path-policy.ts
- test/path-policy.test.ts

Prohibited:
- architecture changes
- public API changes
- unrelated cleanup
```

Preserve authority already granted by the controlling workflow.

Do not invent permissions, budgets, deadlines, or reasoning levels.

Do not specify a reasoning level for the agent unless the owner has explicitly instructed one. Otherwise omit it and let the agent's configured model default apply.

## TIME BUDGET

Every handoff carries one TIME BUDGET line. State the session time budget
and a per-external-call bound smaller than the remaining session time.
Stop starting new work at T minus 5 and write the result.

```text
TIME BUDGET
session: 90 min; per-call: 20 min; stop new work at T minus 5, then write result
```

## LOOP

Write the shortest controlled execution loop.

```text
LOOP

1. Observe the current code and evidence.
2. State a change hypothesis.
3. Make the smallest allowed change.
4. Run focused verification.
5. Inspect the result.
6. If verification fails, classify the failure.
7. Retry only with a new hypothesis or new evidence.
8. Stop when the objective is proven or a genuine blocker exists.
```

Adapt the loop to the role.

### Product Implementer Loop

```text
Observe
→ Hypothesize
→ Implement
→ Test
→ Report
```

### Test Engineer Loop

```text
Read contract
→ Inspect evidence
→ Challenge proof
→ Classify
→ Report
```

### Reviewer Loop

```text
Inspect diff
→ Trace behavior
→ Find introduced defects
→ Prove findings
→ Report verdict
```

### Coordinator Loop

```text
Read wave state
→ Select ready packets
→ Dispatch bounded packet
→ Evaluate returned evidence
→ Advance, repair, or escalate
```

### Orchestrator Loop

```text
Read Lifecycle state
→ Identify ready phases
→ Dispatch direct packets or one Coordinator wave
→ Monitor dependencies
→ Resolve conflicts
→ Integrate or escalate
```

## VERIFY

Name the repository's own gate first — the CI required checks, documented
`tools/` script, or CONTRIBUTING command — and require its exit code. Author-chosen
criteria may supplement that gate; they must not replace it. A VERIFY list that
omits the repository gate is incomplete.

```text
VERIFY
- repository gate: `node --test test/*.test.mjs` and `python3 test/schema-validation.py` exit 0
  (or the workflow required checks this repository already enforces)
- CMD-UNIT-AUTH passes
- unauthorized path test fails before repair and passes afterward
- existing valid-path tests remain passing
- no files outside the write set change
```

Verification must use observable evidence.

Require evidence for every numbered acceptance item and one negative check per named boundary.

Do not use statements such as:

```text
The solution looks correct.
The agent is confident.
The implementation appears complete.
```

## RETURN

Require a machine-routable result.

```text
RETURN

Outcome:
- PASS
- REPAIRABLE_FAILURE
- CONTRACT_FAILURE
- ENVIRONMENT_FAILURE
- NEEDS_MORE_EVIDENCE
- OWNER_DECISION_REQUIRED

Include:
- changed paths
- commands executed
- evidence
- remaining risks
- acceptance-to-evidence table
- blocker, if any
```

Require an acceptance-to-evidence table with one row per item: item, proving test or observation, result. PASS is invalid while any row is unmet or unmapped.

## STOP

Define genuine stop conditions.

```text
STOP WHEN
- the objective is proven
- authority is insufficient
- the contract cannot be satisfied honestly
- required evidence cannot be produced
- an owner or architecture decision is required
```

Do not stop merely because the work is difficult.

## Fan-out (optional)

When one objective holds independent questions, the receiving session may
act as a lead and split them into up to N child sessions of the same role,
one per question, where N is declared in the lead packet. Each child gets
its own packet in this same handoff format, its own write directory, only
its own inputs, and its own TIME BUDGET. Write directories must be distinct.
Children hold the lead's authority and stop only through their own session
handle. The lead only launches the children, waits for them, and merges
their typed returns into one artifact; a missing answer is marked
unanswered. The lead adds no findings beyond the merge.

## Final Check

Before returning the handoff, confirm:

```text
- One role
- One objective
- Known starting state
- Clear authority
- TIME BUDGET line
- Controlled loop
- Observable verification
- Structured return
- Genuine stop conditions
```

Remove repetition, conversation history, generic advice, and unnecessary explanation.

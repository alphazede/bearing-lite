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

## OBJECTIVE

Define one observable outcome.

```text
OBJECTIVE
Reject unauthorized paths without changing valid-path behavior.
```

The objective should describe the result, not vague activity such as “investigate” or “work on.”

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

Define how success is proven.

```text
VERIFY
- CMD-UNIT-AUTH passes
- unauthorized path test fails before repair and passes afterward
- existing valid-path tests remain passing
- no files outside the write set change
```

Verification must use observable evidence.

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
- blocker, if any
```

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

## Final Check

Before returning the handoff, confirm:

```text
- One role
- One objective
- Known starting state
- Clear authority
- Controlled loop
- Observable verification
- Structured return
- Genuine stop conditions
```

Remove repetition, conversation history, generic advice, and unnecessary explanation.

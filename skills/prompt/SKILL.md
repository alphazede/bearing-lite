---
name: prompt
description: >
  Compose one bounded handoff for an already selected agent role and session.
  Do not select roles or routes, start a lifecycle, dispatch agents, add reviews,
  invent budgets, or turn controller procedures into specialist assignments.
type: agent-skill
title: Write Agent Handoff
okf_status: active
tags: [internal, skills]
---

# Write Agent Handoff

Compose the smallest packet for one authorized assignment; launch nothing.
Use the provided role/session, selected route/capability binding, candidate,
objective, acceptance, inputs, exact write set, authority, commands, and return
contract. Missing material inputs are typed gaps, not permission to invent them.
In Bearing, specialist dispatch requires the enabled frozen profile role and task need;
independent review also requires the owner's requested scope and cadence.

## Procedure

1. Select one role/session in `references/role-loops.md` and read its canonical
   skill. That skill owns responsibilities, self-checks, boundaries, and outcomes;
   the index does not override it. Resolve conflicting instructions first.
2. Include useful facts and bindings: paths, source/candidate identities,
   dependencies, recorded decisions, and gaps. Omit raw history and settled-context
   rediscovery. Preserve the provided model, harness, reasoning, and authority.
3. Define one observable objective and numbered acceptance criteria, each touched
   trust boundary/invariant (or none), exact write set, and protected actions.
4. Include the selected loop only. Requirements Engineer owns its requirements-
   quality pass and self-repairs. Other authors check and repair their own outputs.
   Evaluators report without repairing the candidate while evaluating; Light
   Implementer executes the exact command and returns failure without repair.
5. Controllers wait on completion events, wake on responses, and consume each
   result once. Never poll or add automatic fan-out, reviews, or agent invocations.
6. Name the repository gate first and require its exit code; author-selected
   criteria and focused commands supplement it, never replace it, and a VERIFY list
   without it is incomplete. Give expected results and evidence per acceptance item.
   Required missing/not-run proof is a gap. Include time/call
   limits only when supplied; invent no deadline, round count, or reasoning level.
   Require one negative check per named trust boundary. A passing return is invalid
   while an acceptance item is unmet or unmapped in its acceptance-to-evidence table.
7. Use the selected role's exact typed outcomes and genuine stop conditions.

## Packet template

```text
ROLE / SESSION: <selected role/mode and canonical skill>
STATE / INPUTS: <candidate, source bindings, dependencies, known facts>
OBJECTIVE / ACCEPTANCE: <one outcome; numbered observable conditions>
AUTHORITY: <write set, permitted actions, protected boundaries>
LOOP: <one selected loop, its self-checks, and repair boundary>
VERIFY: <repository gate first with exit code, focused checks, expected results, acceptance-to-evidence table>
RETURN / STOP: <compact receipt: verdict, candidate_ref, changed_paths, tests, findings, blocker; remaining work and genuine stops>
```

Intake, combined Alignment/Scope, final Planning and Design, and explicit profile
configuration are controller procedures/helpers, not extra agent roles to invent.

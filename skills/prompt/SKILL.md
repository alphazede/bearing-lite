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
objective, acceptance, inputs, expected files, authority, commands, and return
contract. Missing material inputs are typed gaps, not permission to invent them.
In Bearing, specialist dispatch requires the enabled frozen profile role and task need;
independent review also requires the owner's requested scope and cadence.

## Procedure

1. Select one role/session in `references/role-loops.md` and read its canonical
   skill. That skill owns responsibilities, self-checks, boundaries, and outcomes;
   the index does not override it. Resolve conflicting instructions first.
2. Include useful facts and bindings: paths, source/candidate identities,
   dependencies, recorded decisions, and gaps. Name the verified Git object
   (commit, tree, or blob SHA) for tracked inputs and keep the exact author
   draft through assurance so inputs are read directly instead of reconstructed.
   Omit raw history and settled-context
   rediscovery. Preserve the provided model, harness, reasoning, and authority.
   For a review before a first live apply, include the frozen host and class rows
   and the exact proposed operand list, not only the executor diff.
3. Define one observable objective and numbered acceptance criteria, each touched
   trust boundary/invariant (or none), expected files, and protected actions.
4. Empower the agent within supplied authority and canonical role and repository
   rules. Give the outcome, its intent, and the binding limits: owner/session
   authority, role and repository/contribution rules, protected actions, outside
   access, credentials, destructive git, landing, and new product guards. Name
   expected files as a guide, not a fence. The agent may change what the authorized
   outcome needs (gate inputs, fixtures, affected tests and docs); dependencies and
   lockfiles change only when existing authority and contribution controls permit
   them. Resolve design-versus-reality conflicts with the smallest authorized
   approach, and record each decision and changed path in the return. Stop conditions
   are protected actions, genuine owner decisions, and binding authority conflicts
   the agent cannot resolve, never plumbing inside its authority. The controller
   verifies changed paths after return. When an agent stops or bounces, revise the
   packet first; do not blame the agent for following it. For a delta packet, let
   the author fix its own defects found in the delta rather than constraining the
   packet with "nothing else changed"; record every fix and changed path in the
   return (while machine-checked `correction-delta.cjs` register-row snapshots
   remain bounded to their named UIDs).
5. Include the selected loop only. MBSE owns its requirements-
   quality pass and self-repairs. Other authors check and repair their own outputs.
   When the frozen binding enables Reviewer repair (`reviewer_repair.enabled`), write
   the review packet as a plain request to review and fix; do not forbid repair.
   When `assurance_repair.enabled` is true, preauthorize same-session test-side repair;
   when absent or disabled, evaluators report without repairing. Light
   Implementer executes the exact command and returns failure without repair.
6. Controllers wait on completion events, wake on responses, and consume each
   result once. Never poll or add automatic fan-out, reviews, or agent invocations.
7. For implementation and assurance packets, name the repository gate first and
   require its exit code; author-selected criteria and focused commands
   supplement it, never replace it, and a VERIFY list without it is incomplete.
   For planning specialist packets (`mbse`, `integration_test`), run only that
   specialist's own artifact checker; never run the repository gate in a
   specialist packet—the repository gate runs once at assembly. Give expected
   results and evidence per acceptance item; return digests, commands, and exit
   codes, not narrative logs. Required missing/not-run proof is a gap. Every
   packet carries a time target and "at the limit, return what you have and list
   the gaps"; include call limits only when supplied, and invent no round
   count or reasoning level. Require one negative check per named trust boundary.
   A passing return is invalid while an acceptance item is unmet or unmapped in
   its acceptance-to-evidence table.
8. Use the selected role's exact typed outcomes and genuine stop conditions.

## Packet template

```text
ROLE / SESSION: <selected role/mode and canonical skill>
STATE / INPUTS: <candidate, source bindings, dependencies, known facts>
OBJECTIVE / ACCEPTANCE: <one outcome; numbered observable conditions>
AUTHORITY: <permitted actions; binding owner/session, role, repository and contribution limits; expected files as a guide; protected boundaries>
LOOP: <one selected loop, its self-checks, and repair boundary>
VERIFY: <for implementation/assurance: repository gate first with exit code and focused checks; for planning specialists: own artifact checker only (repository gate runs once at assembly); expected results, acceptance-to-evidence table>
RETURN / STOP: <time target and "at the limit, return what you have and list the gaps"; compact receipt: verdict, candidate_ref, changed_paths, tests (digests, commands, exit codes; not narrative logs), findings, blocker; remaining work and genuine stops>
```

Intake, combined Alignment/Scope, final Planning and Design, and explicit profile
configuration are controller procedures/helpers, not extra agent roles to invent.

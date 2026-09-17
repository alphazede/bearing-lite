---
name: planning-and-design
description: >
  Create or resume Bearing's complete five-artifact planning package after
  material decisions are settled. Use for Planning and Design or missing
  planning artifacts. Do not use to implement, select models, self-approve, or
  bypass the single integrated owner review.
---

# Planning and Design

Fresh planning node. If you are the Orchestrator, dispatch this; do not execute it.

## Match, inputs, and non-match

- **Match:** material intent is settled and any technical-plan, design, SEIT,
  implementation graph, or DoD Manifest is missing, or a named delta packet.
- **Inputs:** confirmed decisions, workspace.md and evidence, artifact status, requirements register,
  repository rules, proposed owner-supplied profile and cadence, plus the return schema. Delta: named findings and proposed text.
- **Non-match:** unresolved material scope, behavior, authority, risk, or
  acceptance intent returns `REROUTE_SCOPE_DEFINITION`; generate no
  `implementation.json` or Manifest.

## Procedure

1. Derive `<lifecycle-topic>-technical-plan.md` from the confirmed title; ask only on
   ambiguity or collision. Establish whether a requirements register exists;
   if repository evidence cannot decide, return `NEEDS_OWNER_DECISION`. Never
   infer one. Registered identities remain references; author only Lifecycle-local
   criteria; author the needed Lifecycle-level proof or return
   `NEEDS_OWNER_DECISION` when register authority is unclear.
2. Author and prospectively check, in dependency order, the testable
   technical-plan, `design.md`, and `seit.json`. Preserve IDs, do not drop
   Lifecycle-level proof or published-standard clause coverage, and select Reverify only on applicable binary-level SEIT claims.
3. Map the implementation graph and propose development strategy
   (`single_implementer` default or `tdd`), role states, profile, reasoning, and
   cadence. Bind the one planning-review slot to owner-supplied
   primary and ordered fallback route references under one candidate ref,
   revision, and digest. Use supplied identities; never invent them.
4. After those stable source inputs, freeze: `node <plugin root>/hooks/plan-package.cjs <plan dir>`
   must PASS; any finding halts. Then generate `implementation.json` and the
   DoD Manifest input together. Each includes the proposed
   route, profile, role states, reasoning, cadence, traceability, waves,
   recovery, approval boundaries, and register references versus Lifecycle-local
   requirements. DoD Manifest states: `planning` then append-only closeout.
5. Give every slice stable requirement/design/SEIT IDs, dependencies, exact
   write set, authority, role, session rule, evidence, recovery, and stop rule.
6. Follow `../bearing-lite/references/owner-stops.md`. Open and verify the Manifest,
   then request exactly one integrated owner review of outcome, design, route, profile,
   cadence, and plan. An owner change regenerates affected artifacts, then returns to
   this same gate; never insert a profile or route pause. Delta mode: apply named
   findings, re-embed digests, return `DELTA_APPLIED`; no fresh package.

## Return and recovery

Return `PLAN_REVIEW_READY`, `REROUTE_SCOPE_DEFINITION`, `DELTA_APPLIED`,
`NEEDS_OWNER_DECISION`, or `VALIDATION_FAILED` with paths, evidence, blocker,
and next action. Owner-decision pauses do not consume correction rounds. At most
two evidence-changing correction rounds; a third is an owner-stops class C question.
Never implement or invent approval.

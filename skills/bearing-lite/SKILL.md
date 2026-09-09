---
name: bearing-lite
description: Bearing Lite Router for Journeys. Not for ordinary work, assigned packets, implementation, or publication.
---

The Router alone writes Journey planning state, owns owner conversation, and owns Expedition sequencing;
planning nodes return owner questions. Plugin hosts are partial; skill-copy is skills-only.

1. Say `Preparing this Journey.` Acquire or resume a generation-bound checkout lease before
   planning or dispatch. A live same-checkout competitor returns `WAITING_ON` with sanitized identity.
2. Resume the next incomplete stage in the same generation; refresh `candidate_revision`.
   Never replay accepted stages or duplicate dispatch. Invalid leases fail closed.
3. If `~/.agents/bearing-lite/default-role-lineup.md` is absent, create a proposed copy
   from `templates/default-role-lineup.md`;
   never infer identity values. The recorded snapshot is authoritative for this Journey.
   Later edits to
   `~/.agents/bearing-lite/default-role-lineup.md` have no effect on it except through an
   explicit owner-confirmed dated visible amendment. Dispatch uses lineup identity from the recorded snapshot.
4. Run Repository Fit → Set Bearings → Gather Supplies; unresolved material intent blocks Map the Route.
5. Invoke Map the Route after settled intent. Do not ask for lineup or route
   before it; carry owner-supplied lineup and `review_cadence: at-end` as proposals.
6. On `PLAN_REVIEW_READY`, enforce `references/review-policy.md`: one candidate,
   unique independent slots, one round and aggregated repair, deterministic PASS,
   no rereview. Journey snapshots bind slots; validation never dispatches. Show one integrated
   approval-or-change gate for outcome, design, route, lineup, role states,
   reasoning, cadence, and plan. Record the approved Journey type and snapshot; regenerate changes.
   Never add a staged lineup or route-review gate.
   Dispatch only after approval.
7. Dispatch from the snapshot. Crewmate and Explorer may continue in-wave unchanged.
   Validate the lease at wave start, after drift, and before commit; use the visible wave receipt
   and update implementation and review once per wave.

Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE`. Three
evidence-changing corrections outside assurance.
`max_assurance_rounds` is 1 per Journey; Direct route checks `assurance_rounds`, never
dispatch Navigator, and one review may authorize one repair. Verify repair
deterministically without another review; failed repair/scope change returns
`OWNER_DECISION_REQUIRED` naming the candidate and count. Only a separately scoped,
materially changed new Journey resets review allowance. `COMPLETE` ends Bearing assurance.
Authorized deployment keeps checks without reopening review.
Planning review is a separate pre-dispatch gate; it never consumes implementation
`required_assurance`, `assurance_rounds`, or `max_assurance_rounds`.
Release the lease once: release the checkout lease exactly once on `COMPLETE` or `CANCELLED`;
recovery needs explicit recorded generation increment.
Recovery cannot steal a live lease.
Never implement, self-assure, select models, or publish.

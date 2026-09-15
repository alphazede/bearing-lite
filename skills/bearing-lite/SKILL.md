---
name: bearing-lite
description: Bearing Lite Orchestrator for Lifecycles. Not for ordinary work, assigned packets, implementation, or publication.
---

Orchestrator alone writes Lifecycle planning state, owns owner conversation, and owns
sequencing; planning nodes return owner questions. Plugin hosts are partial; skill-copy is skills-only.

1. Say `Preparing this Lifecycle.` Acquire or resume a generation-bound checkout lease before
   planning or dispatch. A live same-checkout competitor returns `WAITING_ON` with sanitized identity.
2. Resume the next incomplete stage in the same generation; refresh `candidate_revision`.
   One host-native liveness check classifies RUNNING, COMPLETED, INACTIVE, or UNKNOWN.
   Never replay accepted stages or duplicate dispatch.
   UNKNOWN without owner-requested resume returns `WAITING_ON`.
3. Profile comes only from `~/.agents/bearing-lite/profiles.json`;
   a missing catalog returns `no_named_profiles`,
   never a generated file; never infer identity values. Leftover lineup returns
   `MIGRATION_REQUIRED`. The Orchestrator is observed, not selected.
   The recorded snapshot is authoritative for this Lifecycle. Later edits to
   `~/.agents/bearing-lite/profiles.json` have no effect on it except through an
   explicit owner-confirmed dated visible amendment. Dispatch uses that snapshot.
4. Run Intake → Architectural Alignment → Scope Definition; unresolved material intent blocks Planning and Design.
5. Invoke Planning and Design after settled intent. Do not ask for profile or route
   before it.
6. Enforce `references/review-policy.md` and `references/owner-stops.md`. Show one integrated
   approval-or-change gate. Record the approved Lifecycle type and snapshot.
   Never add a staged profile or route-review gate. Dispatch only after approval.
7. Direct packets never dispatch Coordinator; Orchestrator is the parent controller.
   Implementer may continue in-wave. `work_class: light` slices go to Light
   Implementer; `reclassify: judgement` re-dispatches to Implementer. Use visible wave receipts and update implementation and DoD Manifest once per wave.

Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE`.
`max_assurance_rounds` is 1 per declared phase or wave-end, not per Lifecycle;
Direct route checks `assurance_rounds`, never
dispatch Navigator, and one review may authorize one repair. A needed Coordinator
omitted or disabled is a typed capability gap, not substitution. Verify repair
deterministically without another review; failed repair/scope change returns
`OWNER_DECISION_REQUIRED` naming the candidate and count. `COMPLETE` ends Bearing assurance.
Authorized deployment without reopening review.
Planning review is a separate pre-dispatch gate; never consumes implementation
assurance.
Release the lease once on `COMPLETE` or `CANCELLED`;
recovery needs explicit recorded generation increment and cannot steal a live lease.
Selected or required capabilities activate. Unavailability of selected-or-required
capability is a typed capability gap, not success and not invented behavior.
Unselected and unrequired absence remains inactive, not a global failure.
Never implement, self-assure, select models, or publish.

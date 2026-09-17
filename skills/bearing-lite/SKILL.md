---
name: bearing-lite
description: Bearing Lite Orchestrator for Lifecycles. Not for ordinary work, assigned packets, implementation, or publication.
---

Orchestrator alone writes Lifecycle planning state, owns sequencing and owner
conversation; planning nodes return owner questions. Plugin hosts are partial; skill-copy is skills-only.

1. Say `Preparing this Lifecycle.` Acquire or resume a generation-bound checkout lease before
   planning or dispatch. Same-checkout competitor returns `WAITING_ON` with sanitized identity.
   Resume the next incomplete stage in the same generation, refreshing `candidate_revision`.
   One host-native liveness check classifies RUNNING, COMPLETED, INACTIVE, or UNKNOWN.
   Never replay accepted stages or duplicate dispatch. Invalid leases fail closed.
   UNKNOWN without owner-requested resume returns `WAITING_ON`.
2. Profile comes only from `~/.agents/bearing-lite/profiles.json` (`references/profiles.md`);
   missing catalog returns `no_named_profiles`, never a generated file;
   never infer identity values. Leftover lineup returns `MIGRATION_REQUIRED`.
   The Orchestrator is observed, not selected.
   The recorded snapshot is authoritative for this Lifecycle. Dispatch uses that snapshot.
   Later edits to `~/.agents/bearing-lite/profiles.json` have no effect on it
   except by explicit owner-confirmed dated visible amendment.
3. Run Intake → Architectural Alignment → Scope Definition as dispatched sessions with `BEARING_ROLE` set; reading a stage `SKILL.md` is not running it. unresolved material intent blocks Planning and Design.
   Invoke Planning and Design once settled; consume the receipt. Plan-artifact findings dispatch a delta (`BEARING_ROLE=planning_and_design`).
   Do not ask for profile or route before it; carry owner-supplied profile and cadence.
4. Enforce `references/review-policy.md`, `references/owner-stops.md`. Show one integrated
   approval-or-change gate. Record the approved Lifecycle type and snapshot.
   Never add a staged profile or route-review gate. Dispatch only after approval.
   Direct packets never dispatch Coordinator; Orchestrator is the parent controller.
   tdd: frozen snapshot's Test Implementer (`roles.test_implementer`) before Product Implementer.
   Implementer may continue in-wave. `work_class: light` goes to Light Implementer;
   `reclassify: judgement` back to Implementer. Use visible wave receipts;
   update implementation and DoD Manifest once per wave.

Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, `COMPLETE`.
`max_assurance_rounds` is 1 per declared phase or wave-end, not per Lifecycle;
Direct route checks `assurance_rounds`, never dispatch Navigator; one review may authorize
one repair, verified deterministically without another review.
Failed repair/scope change returns `OWNER_DECISION_REQUIRED` naming the candidate and count.
`COMPLETE` ends Bearing assurance; authorized deployment without reopening review.
Planning review is a separate pre-dispatch gate; never consumes implementation assurance.
Release the lease once: release the checkout lease exactly once on `COMPLETE` or `CANCELLED`;
recovery needs explicit recorded generation increment, cannot steal a live lease.
Selected or required capabilities activate; unavailability, including a needed Coordinator
omitted or disabled, is a typed capability gap, not substitution, not success,
not invented behavior.
Unselected and unrequired absence remains inactive, not a global failure.
Never implement, self-assure, select models, publish.

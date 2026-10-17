---
name: bearing-lite
description: Bearing Lite Orchestrator for Lifecycles. Not for ordinary work, assigned packets, implementation, or publication.
---

Orchestrator alone writes Lifecycle control state, owns sequencing and owner
conversation; never specialist artifacts; planning nodes return owner questions.
Scribe transcribes history, dispatched by its frozen cadence (`event` default), never by memory. Plugin hosts are partial; skill-copy is skills-only.

1. Say `Preparing this Lifecycle.` Acquire or resume a generation-bound checkout lease before
   planning or dispatch. Same-checkout competitor returns `WAITING_ON` with sanitized identity.
   Resume the next incomplete stage in the same generation, refreshing `candidate_revision`.
   One host-native liveness check classifies RUNNING, COMPLETED, INACTIVE, or UNKNOWN.
   Never replay accepted stages or duplicate dispatch. Invalid leases fail closed.
   UNKNOWN without owner-requested resume returns `WAITING_ON`.
   On resume, run `hooks/scribe-coverage.cjs` on `journey.json` and list untranscribed events.
2. Profile comes only from `~/.agents/bearing-lite/profiles.json` (`references/profiles.md`);
   missing catalog returns `no_named_profiles`, never a generated file;
   never infer identity values. Leftover lineup returns `MIGRATION_REQUIRED`.
   The Orchestrator is observed, not selected.
   The recorded snapshot is authoritative for this Lifecycle. Dispatch uses that snapshot.
   Later edits to `~/.agents/bearing-lite/profiles.json` have no effect on it
   except by explicit owner-confirmed dated visible amendment.
3. Run Intake → Architectural Alignment → Scope Definition as dispatched sessions with `BEARING_ROLE` set; reading a stage `SKILL.md` is not running it. unresolved material intent blocks Planning and Design.
   Dispatch the Plan Integrator once settled (`BEARING_ROLE=plan_integrator`); consume its receipt. It dispatches every planning session; the Orchestrator never relays between them or runs them, and neither does Coordinator. Its order puts the Systems Modeler contextual pass (current flow, candidate placements with `file:line`, constraints), when that role is selected or required, before the first register draft, per `../planning-and-design/references/allocation-inputs.md`; an unavailable Systems Modeler is a typed capability gap, never silent allocation. Plan-artifact findings dispatch a delta through the Plan Integrator (`BEARING_ROLE=planning_and_design`).
   Planning is one wave (`../plan-integrator/references/planning-wave.md`): `hooks/register-precheck.cjs` and Requirements Engineer findings feed its one review without spending a correction round; no session waits on a Requirements Engineer pass. Do not ask for profile or route before it; carry owner-supplied profile and cadence.
4. Enforce `references/review-policy.md`, `references/owner-stops.md`.
   Apply `exact_text` without a re-gate; record the mechanical verification receipt per `../planning-and-design/references/correction-loop.md`. Only `requires_regate` rows spend the one correction round; a further one returns `NEEDS_OWNER_DECISION`. Show one integrated approval-or-change gate with residuals. Record the approved Lifecycle type and snapshot.
   Never add a staged profile or route-review gate. Dispatch only after approval.
   Direct packets never dispatch Coordinator; Orchestrator is the parent controller.
   tdd: frozen snapshot's Test Implementer (`roles.test_implementer`) before Product Implementer.
   Implementer may continue in-wave. `work_class: light` goes to Light Implementer;
   `reclassify: judgement` back to Implementer. Use visible wave receipts;
   update implementation and DoD Manifest once per wave. Specialist fan-out children run under the lead's frozen route as one specialist dispatch, never extra reviewer or assurance rounds (see `references/specialist-fan-out.md`).

Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, `COMPLETE`.
`max_assurance_rounds` is 1 per declared phase or wave-end, not per Lifecycle;
Direct route checks `assurance_rounds`, never dispatch Navigator; one review may authorize
one repair, verified deterministically without another review.
Failed repair/scope change returns `OWNER_DECISION_REQUIRED` naming the candidate and count.
`COMPLETE` ends Bearing assurance; authorized deployment without reopening review.
Planning review is a separate pre-dispatch gate; never consumes implementation assurance.
Handoff and closeout pass `journey` to `hooks/closeout.cjs`; untranscribed decisions,
authority events, or landings refuse them until the Scribe runs.
Release the lease once: release the checkout lease exactly once on `COMPLETE` or `CANCELLED`;
recovery needs explicit recorded generation increment, cannot steal a live lease.
Selected or required capabilities activate; unavailability, including a needed Coordinator
or Scribe omitted or disabled, is a typed capability gap, not substitution, not success,
not invented behavior.
Unselected and unrequired absence remains inactive, not a global failure.
Never implement, self-assure, select models, publish, or transcribe history.

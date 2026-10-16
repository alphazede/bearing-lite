---
name: scribe
description: >
  Transcribe Lifecycle decisions, authority events, ledger snapshots, and
  profile selections as an event side lane. Use for Scribe. Do not use to
  activate authority, invent choices, or save profiles unless the owner
  asks.
---

# Scribe

Event side lane. Transcribes; cannot activate authority.

## Inputs and match

- **Inputs:** owner decisions, authority events, Scope Definition ledger snapshots,
  profile selections, configuration digest, `journey.json`.
- **Match:** a visible Lifecycle event must be appended to history. The
  Orchestrator dispatches the Scribe by the frozen `roles.scribe.cadence`:
  `event` (default: after each owner decision, authority event, or landing),
  `phase` (each phase or wave boundary), or `lifecycle` (handoff and
  closeout only). Every cadence also runs before handoff and closeout.
- **Non-match:** planning dispatch, specialist engineering, execution.

## Algorithm

1. Append owner decisions, authority events, ledger snapshots, profile
   selections, configuration digest, and observed landings (`landings`:
   merges and issue closes) to `journey.json` history. Each history entry
   carries the source record's `id`; coverage matches on it.
   Follow `../bearing-lite/references/owner-stops.md` for typed owner-stop
   records: preserve question and round-trip IDs, record actual asked/answered
   UTC times and explicit fully blocked intervals, and never infer missing
   times. Automatic resolutions and owner steering are not invented questions.
2. Do not activate authority or invent unresolved choices. Finish with
   `node <plugin root>/hooks/scribe-coverage.cjs <journey.json>`; return
   `READY` only on its PASS.
3. Do not write Lifecycle selections into `profiles.json` unless the owner
   asks to save a reusable profile.

## Return and recovery

Return `READY` or `OWNER_DECISION_REQUIRED` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Never implement, self-assure, or select models.

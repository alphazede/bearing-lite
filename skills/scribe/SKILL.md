---
name: scribe
description: >
  Transcribe Journey decisions, authority events, ledger snapshots, and
  lineup selections as an event side lane. Use for Scribe. Do not use to
  activate authority, invent choices, or save lineups unless the owner
  asks.
---

# Scribe

Event side lane. Transcribes; cannot activate authority.

## Inputs and match

- **Inputs:** owner decisions, authority events, Gather ledger snapshots,
  lineup selections, configuration digest, `journey.json`.
- **Match:** a visible Journey event must be appended to history.
- **Non-match:** planning dispatch, specialist engineering, execution.

## Algorithm

1. Append owner decisions, authority events, ledger snapshots, lineup
   selections, and configuration digest to `journey.json` history.
   Follow `../bearing-lite/references/owner-stops.md` for typed owner-stop
   records: preserve question and round-trip IDs, record actual asked/answered
   UTC times and explicit fully blocked intervals, and never infer missing
   times. Automatic resolutions and owner steering are not invented questions.
2. Do not activate authority or invent unresolved choices.
3. Do not write Journey selections into `lineups.json` unless the owner
   asks to save a reusable profile.

## Return and recovery

Return `READY` or `OWNER_DECISION_REQUIRED` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Never implement, self-assure, or select models.

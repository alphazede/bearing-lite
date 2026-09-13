---
name: onboard-bearing
description: >
  Guided first-run and later configuration of profiles.json. Use for
  onboard-bearing, profile setup, or explicit configuration change. Do not
  use to infer settings, store credentials, or write during ordinary
  Lifecycles.
---

# onboard-bearing

Reusable guided configuration. Inspects `profiles.json` when present. Asks
one setting at a time. May recommend; never selects or writes without the
user's explicit instruction. Preserves every unaddressed existing value.

## Inputs and match

- **Match:** first run, missing profile, explicit configuration change, or
  `MIGRATION_REQUIRED` from a legacy lineup catalog.
- **Non-match:** ordinary Lifecycle dispatch, silent repair of a valid profile.

## Algorithm

1. Resolve `<absolute home>/.agents/bearing-lite/profiles.json` per
   `references/profiles.md`. Never read packaged bytes as user data. Never
   search, merge, prefer, or fall back to `lineups.json`.
2. If a user `lineups.json` exists, return `MIGRATION_REQUIRED`. Do not
   consume it as live configuration. Migration validates the lineup, asks
   which route to assign to Integration Engineer execution, writes a
   semantically equivalent `profiles.json`, validates readback, then removes
   `lineups.json`. Do not auto-assign Surveyor or any retired role.
3. Ask settings one at a time with no preselected value: named role/session
   routes and fallbacks, session enablement, development strategy,
   planning review, assurance cadence, concurrency, clean-session, holds, and
   optional Reverify. Declining Reverify or its download persists
   `reverify.enabled: false` for that named profile.
4. Write only explicit choices atomically. Validate Draft 2020-12 readback
   against `schemas/profiles.schema.json`. Store no credentials.

## Return and recovery

Return `READY`, `MIGRATION_REQUIRED`, `no_named_profiles`, or
`OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests,
findings, and blocker.

Never invent a setting, write the packaged catalog, or keep a lineup fallback.

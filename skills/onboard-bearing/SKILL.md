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
   which route to assign to Integration Engineer execution, and must ask
   for the missing Test Implementer; it never copies or invents that route.
   It then writes a semantically equivalent `profiles.json`, validates
   readback, then removes `lineups.json`. Do not auto-assign Surveyor or any
   retired role.
3. Ask settings one at a time with no preselected value: named role/session
   routes and fallbacks, session enablement, development strategy,
   planning review, assurance cadence, concurrency, clean-session, holds, and
   optional Reverify. When `development_strategy.mode` is `tdd`, collect Test
   Implementer (`roles.test_implementer`) independently of Product Implementer
   (`roles.implementer`). A missing, disabled, or malformed Test Implementer
   route returns `OWNER_DECISION_REQUIRED` with an onboard prompt; must ask
   for the missing Test Implementer and never copies or invents a route from
   Product Implementer, Test Engineer, Light Implementer, or a retired role.
   `single_implementer` stays valid with no `test_implementer` field. Enabling Coordinator adds value only for a one-wave need
   (two or more proven-independent packets, shared wave evidence, or aggregate repair
   ownership); permit an explicit disabled choice. A disabled Coordinator
   on a true direct packet is not a capability gap. Declining Reverify or its
   download persists `reverify.enabled: false` for that named profile.
   Ask whether a parallel review capability is enabled and required
   (`review.parallel_review`); an explicit disabled choice is not a capability
   gap, and its provider, model and credentials stay in its own tooling.
4. Write only explicit choices atomically. Validate Draft 2020-12 readback
   against `schemas/profiles.schema.json`. Store no credentials.

## Return and recovery

Return `READY`, `MIGRATION_REQUIRED`, `no_named_profiles`, or
`OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests,
findings, and blocker.

Never invent a setting, write the packaged catalog, or keep a lineup fallback.

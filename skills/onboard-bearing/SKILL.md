---
name: onboard-bearing
description: >
  Guided first-run and later configuration of profiles.json. Use for
  explicit profile setup or configuration change. Do not
  use to infer settings, store credentials, or write during ordinary
  Lifecycles.
---

# onboard-bearing

Inspect `profiles.json` when present and ask one setting at a time.
For first-run or a requested walkthrough, print the welcome and opening question verbatim from `references/welcome.md`; offer its Lite/Full starting points. Explain each role from its canonical sibling `SKILL.md` before configuring it, including Integration Engineer's separate planning and execution sessions. Targeted edits skip the tour and ask only missing choices.
Recommend without selecting or writing unless explicitly instructed; preserve unaddressed values.
Loop: obtain explicit choices → validate → save authorized fields → validate readback → return.

## Inputs and match

- **Match:** owner-requested first-run setup, configuration change, or migration; a missing profile alone never authorizes writes.
- **Non-match:** ordinary Lifecycle dispatch, silent repair of a valid profile.

## Algorithm

1. Resolve `<absolute home>/.agents/bearing-lite/profiles.json` per
   `../bearing-lite/references/profiles.md`. Never read packaged bytes as user data. Never
   search, merge, prefer, or fall back to `lineups.json`.
2. If a user `lineups.json` exists, return `MIGRATION_REQUIRED`. Do not
   consume it as live configuration. Migration validates the lineup; ask which
   route to assign to Integration Engineer execution only if that session is enabled.
   Ask for a missing Test Implementer only in `tdd`; never copy or invent its route.
   It then writes a semantically equivalent `profiles.json`, validates
   readback, then removes `lineups.json`. Do not auto-assign Surveyor or any
   retired role. A retired `roles.plan_integrator` or `roles.planning_and_design`
   route also returns `MIGRATION_REQUIRED`: final planning/design is the Planning
   Orchestrator's own procedure. On explicit request, show and remove only that key;
   preserve every other role, model, fallback, and capability; never copy its route.
3. Ask settings one at a time within the requested scope, with no preselected value; skip supplied or unchanged choices: named role/session
   routes and fallbacks, session enablement, development strategy,
   planning review, assurance cadence, Scribe cadence, concurrency, clean-session, holds, and
   optional Reverify. When `development_strategy.mode` is `tdd`, collect Test
   Implementer (`roles.test_implementer`) independently of Product Implementer
   (`roles.implementer`). A missing, disabled, or malformed Test Implementer route
   returns `OWNER_DECISION_REQUIRED` with an onboard prompt; must ask for the missing
   Test Implementer and never copies or invents a route from Product Implementer,
   Test Engineer, Light Implementer, or a retired role.
   `single_implementer` stays valid with no `test_implementer` field. Enabling Coordinator adds value only for a one-wave need
   (two or more proven-independent packets, shared wave evidence, or aggregate repair
   ownership); permit an explicit disabled choice. A disabled Coordinator on a true direct packet is not a capability gap. Declining Reverify or its
   download persists `deterministic_verification.reverify.enabled: false` for that named profile. Ask whether
   coverage assist (`review.coverage_assist`) is enabled and required; an explicit
   disabled choice is not a gap; its provider, model and credentials stay in its tooling. Use `references/verification-tools.md` to explain OCR, Reverify, and other optional testing tools and collect explicit choices.
   For requested delegation configuration, use `../bearing-lite/references/owner-stops.md#coordinator-escalation-and-delegation`: explain Coordinator local decisions and two-attempt escalation; store `orchestrator-delegation` in holds, disabled unless explicitly enabled. Explain that enabled mode needs scoped task authority, exclusions and expiry, preserves protected actions and review/repair limits, and carries frozen decision holds into packets.
4. Every specialist role is optional. Save explicit enabled/disabled choices;
   configuring a Reviewer does not request review for a task. Write only authorized
   choices atomically; validate schema readback. Store no credentials or unrequested backups.

## Return and recovery
Return `READY`, `MIGRATION_REQUIRED`, `no_named_profiles`, or `OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests, findings, and blocker.

Never invent a setting, write the packaged catalog, or keep a lineup fallback.

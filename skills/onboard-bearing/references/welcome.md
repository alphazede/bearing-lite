---
type: agent-reference
title: Onboarding Welcome and Starting Points
tags: [bearing, onboarding]
---

# Welcome and starting points

Before opening any interview, classify the user's catalog at
`<absolute home>/.agents/bearing-lite/profiles.json` using the read-only
validator (`scripts/validate-profiles.mjs` / `hooks/profiles.cjs`).
Honor an already-supplied mode, action, or profile name first (for example,
"change the Reviewer in Work" goes straight to that edit; "Create my first
profile" starts guided first-profile setup; an explicit Full or Lite request
uses that starting point without re-asking the opening menu).

On an open first run, or when the user requests a walkthrough, print this
welcome verbatim to the user:

> Welcome to Bearing. Bearing brings a production-grade SDLC to vibe-coded projects: clarify requirements, plan and design, implement, verify, and deliver. You choose which specialist roles participate, which agents they use, and when independent review runs.

Then ask this opening question and wait for the user's choice, without a
preselected answer:

> How would you like to begin: guided onboarding (create my first profile step by step), configure an existing profile in profiles.json (not legacy lineups.json), recommended Lite setup, or Full setup?

Here, configuring an existing profile (sometimes called an agent lineup) means
editing role/session assignments in `profiles.json`; it never reads,
activates, or recreates the legacy `lineups.json` file.

| Choice | What the agent does |
| --- | --- |
| Guided onboarding | Run `references/guided-first-profile.md`: classify the catalog, check local tool presence with consent, explain roles and profiles, collect owner-supplied identities and explicit choices, preview one row per changed choice, validate before/after atomic save, offer an opt-in launch probe, and give a copyable next request. |
| Configure an existing profile in profiles.json (not lineups.json) | Show the relevant current assignments in `profiles.json`; change only what the user requests and preserve all unaddressed profiles, routes, and extension keys. |
| Recommended Lite setup | Propose `single_implementer` for code and tests, task-needed `mbse` and `integration_test` planning, and minimal additional specialists. Reuse adequate existing planning evidence. |
| Full setup | Walk through all configurable roles and sessions (`mbse`, `integration_test`, `test_engineer.sessions.assurance`, `integration_engineer.sessions.execution`, `implementer`, `test_implementer`, `light_implementer`, `reviewer`, `scribe`, plus catalog-level `fellow`), development strategy, capabilities (`review.coverage_assist`, `deterministic_verification`, `assurance_repair`), cadence, clean-session, concurrency, holds, and defaults. |

Lite, Full, and guided onboarding are configuration workflows, not runtime
modes, fixed model lineups, or legacy `lineups.json` presets. Show the
proposed rows and settings before saving; Bearing never fills, suggests, ranks,
or characterizes harnesses, models, or reasoning levels—the owner supplies every
route identity. All starting points retain required evidence and gates.
Configuring review or assessment does not request it for a task. Dispatch still
requires the role to be enabled, needed, and authorized at that boundary.

For a targeted configuration edit, skip the welcome, opening menu, and full
questionnaire unless requested. Use choices already supplied; ask only for
missing information needed to make the requested change.

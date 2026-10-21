---
type: agent-reference
title: Onboarding Welcome and Starting Points
tags: [bearing, onboarding]
---

# Welcome and starting points

On first run, or when the user requests a walkthrough, the agent prints this
welcome verbatim to the user:

> Welcome to Bearing. Bearing brings a production-grade SDLC to vibe-coded projects: clarify requirements, plan and design, implement, verify, and deliver. You choose which specialist roles participate, which agents they use, and when independent review runs.

Then ask this opening question and wait for the user's choice, without a
preselected answer:

> How would you like to begin: guided onboarding, configure an existing agent lineup, recommended Lite setup, or Full setup?

Here, an agent lineup means role/session assignments in `profiles.json`;
it does not reactivate the legacy `lineups.json` file.

| Choice | What the agent does |
| --- | --- |
| Guided onboarding | Explain the available choices and configure the requested profile one setting at a time. |
| Configure an existing agent lineup | Show the relevant current assignments; change only what the user requests. |
| Recommended Lite setup | Propose `single_implementer` for code and tests, task-needed requirements/test planning, and minimal additional specialists or coordination. Reuse adequate existing planning evidence. |
| Full setup | Walk through all configurable roles and sessions, development strategy, capabilities, and cadence so the user can select the support they need. |

Lite and Full are configuration starting points, not runtime modes or fixed model
lineups. Show the proposed roles and settings before accepting a starting point;
do not select harnesses, models, reasoning, fallbacks, or enable optional roles
without the user's explicit choices. Both retain required evidence and gates.
Configuring review or assessment does not request it for a task. Dispatch still
requires the role to be enabled, needed, and authorized at that boundary.

For a targeted configuration edit, skip the welcome, opening menu, and full
questionnaire unless requested. Use choices already supplied; ask only for
missing information needed to make the requested change.

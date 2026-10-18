---
type: agent-reference
title: Optional Review and Testing Tools
tags: [bearing, onboarding, verification]
---

# Explain tools before configuring them

During requested onboarding, explain each applicable choice below in plain
language, then ask whether the user wants it. All three are optional; accept
disabled or empty choices without a repeated prompt. For a targeted edit, discuss
only the requested tools. Preserve every unaddressed setting. Configuring a tool
does not request independent review, enable an agent role, install software, or
authorize commands. Required project checks still apply.

## OCR — OpenCodeReview

OCR identifies reviewable changed files, exclusions, and the review rules that
apply. The Reviewer uses this deterministic guidance to inspect the code and
produce findings. OCR does not supply an independent reviewer or acceptance.

Store the user's choices in `review.coverage_assist.enabled` and
`review.coverage_assist.required`. Both false means off. Enabled-only permits
continuing with a recorded gap if unavailable; required means the review cannot
proceed without it. Missing or unrun coverage is never a passing result. Its
provider, models, and credentials remain in the tool's own configuration.

## Reverify

Reverify checks explicit verification claims through its selected backend and
returns candidate-bound evidence. Explain it as an optional verification tool,
not a replacement for tests or human acceptance. It is used for applicable
binary-level claims; ordinary source-only work does not need a binary check.

Store the choice in `deterministic_verification.reverify.enabled`. Explain any
applicable backend/tool requirements before enabling it. Installation needs
separate authorization. Declining either the tool or its installation records
false; ordinary work does not ask again. Selected but unavailable or unrun
verification stays a typed gap, never PASS. The backend keeps its credentials.

## Other testing tools

Ask: "Would you like to add other testing tools or repository checks, such as
unit/integration tests, linting, coverage, mutation testing, or security scans?"

Prefer the repository's existing scripts and tools. For each user-chosen entry,
collect its name and enabled/disabled choice; for enabled entries collect the
actual repository command, pass rule, and expected evidence. Disabled entries
need no new command questions. Explain unfamiliar tool names briefly. Do not invent
commands, thresholds, routes, or defaults. Do not put credentials in commands.
Save entries under `deterministic_verification.additional_tools`; omitted or
`[]` means no extra tools, and an entry with `enabled: false` stays inactive.

The selected profile freezes these entries alongside routes and other
capabilities. Planning Test Engineer, when selected, maps applicable enabled
entries into SEIT procedures/commands, pass/fail criteria, and evidence. Otherwise
reuse an adequate authorized validation plan; tool selection does not create a
new author. Implementation runs approved task commands, not arbitrary profile
commands automatically. An unavailable or not-run declared gate is a typed gap.
Required checks are never waived by disabling an optional profile entry.

Example fields for a user-confirmed repository test command:

```json
{
  "review": { "coverage_assist": { "enabled": false, "required": false } },
  "deterministic_verification": {
    "reverify": { "enabled": false },
    "additional_tools": [{
      "name": "Repository tests",
      "enabled": true,
      "command": "node --test test/*.test.mjs",
      "pass": "Exit 0; no failed tests",
      "evidence": "Test summary and exit code for the exact candidate"
    }]
  }
}
```

The example is not a preselected command. Validate against the profile schema
and save only explicit choices. Existing profiles without this list remain valid.

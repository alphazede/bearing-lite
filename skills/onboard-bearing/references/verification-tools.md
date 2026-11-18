---
type: agent-reference
title: Optional Review and Testing Tools
tags: [bearing, onboarding, verification]
---

# Explain tools before configuring them

During requested onboarding, explain each applicable choice below in plain
language, then ask whether the user wants it. All options are optional; accept
disabled or empty choices without a repeated prompt. For a targeted edit, discuss
only the requested tools. Preserve every unaddressed setting. Configuring a tool
does not request independent review, enable an agent role, install software, or
authorize commands. Required project checks still apply.

## OCR — OpenCodeReview (`review.coverage_assist`)

OCR identifies reviewable changed files, exclusions, and the review rules that
apply. The Reviewer uses this deterministic guidance to inspect the code and
produce findings. OCR does not supply an independent reviewer or acceptance.

Store the user's choices in `review.coverage_assist.enabled` and
`review.coverage_assist.required`. `enabled` and `required` are independent,
with four distinct states (R18):

| `enabled` | `required` | Adapter state when unavailable | Meaning |
| --- | --- | --- | --- |
| `false` | `false` | `INACTIVE` | Explicitly off; write **both** flags `false` when the owner turns coverage off. |
| `true` | `false` | `UNAVAILABLE` / `proceed-with-note` | Selected optional assist; proceed with a recorded typed gap if unavailable. |
| `false` | `true` | `UNAVAILABLE` / `halt` | Required-only activation; review cannot proceed without OCR. |
| `true` | `true` | `UNAVAILABLE` / `halt` | Enabled and required (`required` has force); review cannot proceed without OCR. |

Missing or unrun coverage is never a passing result. OCR's provider, models, and
credentials remain in the tool's own configuration (outside Bearing Lite's
public profile schema).

## Reverify (`deterministic_verification.reverify`)

Reverify checks explicit verification claims through its selected backend and
returns candidate-bound evidence. Explain it as an optional verification tool,
not a replacement for tests or human acceptance. It is used for applicable
binary-level claims; ordinary source-only work does not need a binary check.

Four distinct branches govern Reverify setup (R22):

1. **Unavailable backend:** explain that the backend is not locally available;
   enabling `reverify.enabled: true` never installs software automatically.
2. **Separately authorized installation:** installation requires explicit,
   separate owner approval before any download or installer runs.
3. **Explicit decline:** declining Reverify or declining its installation records
   `deterministic_verification.reverify.enabled: false` for that named profile
   and ordinary Lifecycles do not ask again.
4. **Later candidate verification:** at runtime, selected-but-unavailable or
   unrun Reverify stays a typed gap, never `PASS`. Candidate-bound receipts
   determine verification; evaluator hooks ignore installation hints. The
   backend keeps its own credentials.

## Assurance repair (`assurance_repair.enabled`)

Offer `assurance_repair.enabled` in Full setup and whenever assurance behavior
is edited (R16). Explain its preconditions and scope: when `true`, the frozen
profile preauthorizes **one** bounded same-session repair by the Assurance Test
Engineer of proven test-side defects per assurance round (reusing the
`repair_transition` contract; product defects still `FAIL`). Omitting it or
setting `assurance_repair.enabled: false` gives no repair preauthorization;
preserve omission or `false` when the owner declines.

## Other testing tools (`deterministic_verification.additional_tools`)

Ask: "Would you like to add other testing tools or repository checks, such as
unit/integration tests, linting, coverage, mutation testing, or security scans?"

Prefer the repository's existing scripts and tools. For each user-chosen entry,
collect its `name` and `enabled` choice; for enabled entries (`enabled: true`)
collect the actual repository `command`, `pass` rule, and expected `evidence`.
Disabled entries (`enabled: false`) need only `name` and `enabled` (no command
questions). Explain unfamiliar tool names briefly. Do not invent commands,
thresholds, routes, or defaults. Do not put credentials in commands.
Save entries under `deterministic_verification.additional_tools`; omitted or
`[]` means no extra tools, and an entry with `enabled: false` stays inactive.

The selected profile freezes these entries alongside routes and other
capabilities. Integration and Test planning (`roles.integration_test.sessions.planning`),
when enabled, maps applicable enabled entries into SEIT procedures/commands,
pass/fail criteria, and evidence. Otherwise reuse an adequate authorized
validation plan; tool selection does not create a new author. Implementation runs
approved task commands, not arbitrary profile commands automatically. An
unavailable or not-run declared gate is a typed gap. Required checks are never
waived by disabling an optional profile entry.

## Compiler compatibility and active handoff path (R05)

`skills/bearing-lite/` uses the Prompt packet template as the active default
handoff path, and `tools/compile-handoff.mjs` is the optional deterministic
handoff compiler. Profiles configured here (with or without `review`,
`deterministic_verification.reverify`, `coverage_assist.required`, or
`deterministic_verification.additional_tools`, and without private host
extension fields such as `ocr_execution_mode`) freeze cleanly via
`hooks/profiles.cjs` and compile cleanly through `tools/compile-handoff.mjs`.

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
  },
  "assurance_repair": { "enabled": false }
}
```

The example is not a preselected command. Validate Bearing Lite fields against
the profile schema (`scripts/validate-profiles.mjs` and
`references/profiles.schema.json`), run `evaluateCatalogState`, `validateCatalog`,
and `freezeSelectedRoutes` from `hooks/profiles.cjs` when available, preserve any
unaddressed or declared host-extension-owned keys losslessly, and save only
explicit choices. Existing profiles without `additional_tools` or
`assurance_repair` remain valid.

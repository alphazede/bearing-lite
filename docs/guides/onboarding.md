# Onboarding Bearing Lite

After installing the plugin or copying `skills/`, ask your agent to run
[onboard-bearing](../../skills/onboard-bearing/SKILL.md). For a first profile,
use the [guided walkthrough](../../skills/onboard-bearing/references/guided-first-profile.md).
For an existing profile, name the profile and the setting you want to change.

## Set up a named profile

1. The agent checks your user catalog at `~/.agents/bearing-lite/profiles.json`
   before proposing changes. Name the profile and confirm whether to create,
   edit, or replace it.
2. Choose the [roles and sessions](roles.md) you want to enable. You supply
   every harness, model, reasoning setting, and fallback. Use
   `single_implementer` for one author of code and tests, or supply both
   Test Implementer and Product Implementer routes independently for `tdd`.
3. If you want a Fellow, supply one catalog-wide route. Every profile uses the
   same [Fellow](../../skills/bearing-lite/references/consultation.md#fellow).
   The Orchestrator itself uses the session you open.
4. Review the proposed edits, including the profile name, destination, and
   any catalog-wide changes. Approve the save. The agent uses the same
   read-only validator before saving and on readback. The validator ships in
   the onboarding skill and runs with Node.js in a skills-only install:

   ```sh
   node ./skills/onboard-bearing/scripts/validate-profiles.mjs
   ```

   Run the example from the package root or adjust the script path to your
   skill location. The command reads the user catalog. The agent preserves
   unaddressed settings and follows the
   [extension validation contract](../../skills/onboard-bearing/references/catalog-contract.md)
   for host-owned keys.
5. If you want the agent to test a route, approve that launch separately.
   A profile can be saved with `launch tested: not tested`.

Use the saved profile by saying “Use my Everyday profile to plan and implement
this task.” Catalog edits apply to future selections. A running Lifecycle uses
its frozen selection. Request planning review on the task when you want it.

## Optional settings

The [verification settings guide](../../skills/onboard-bearing/references/verification-tools.md)
covers OpenCodeReview coverage, Reverify, additional repository checks, and
bounded assurance repair. A selected tool does not authorize installation,
execution, or review. Declining Reverify or its download records
`deterministic_verification.reverify.enabled: false` for the profile.

For clean-session, concurrency, holds, and defaults, use the
[catalog field map](../../skills/onboard-bearing/references/catalog-contract.md#1-exact-catalog-field-map-r19).
A clean session uses the written handoff in a fresh Implementation Orchestrator
session. Otherwise the current session can continue from the durable artifacts.

Legacy Coordinator catalog entries are ignored for new dispatch. A frozen
Coordinator assignment needs its pinned runtime or an explicit handover.

## Migrate older configuration

A leftover `lineups.json` or an obsolete `roles.fellow` triggers
`MIGRATION_REQUIRED`. Ask the onboarding skill to follow the appropriate
[migration procedure](../../skills/onboard-bearing/references/catalog-contract.md#migration).

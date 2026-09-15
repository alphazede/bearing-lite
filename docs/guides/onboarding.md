# Onboarding Bearing Lite

Use this page after installing the plugin or copying `skills/`.

## First run

1. Confirm Node.js is on `PATH` if you will use hook adapters.
2. Invoke **onboard-bearing**.
3. Answer one setting at a time. The skill may recommend a value; it never
   selects or writes without your explicit instruction.
4. Unaddressed existing values stay unchanged.
5. Validate the resulting `~/.agents/bearing-lite/profiles.json` readback.

Settings include named role and session routes, fallbacks, session
enablement, development strategy, planning review, assurance cadence,
concurrency, planning-to-implementation clean-session, holds, and optional
Reverify. No value is preselected. When development strategy is `tdd`,
collect Test Implementer independently of Product Implementer. Do not copy
Product Implementer, Test Engineer, Light Implementer, or a retired role.
A missing Test Implementer route must ask; it is not inferred.
`single_implementer` stays valid with no Test Implementer field.

Enabling Coordinator adds value only when the approved implementation graph
has a one-wave need: two or more proven-independent packets in the same
wave, shared wave evidence that must be integrated once per wave, or
aggregate repair ownership across packets in that wave.
`roles.coordinator.enabled` means the route is available, not that every
packet gets a Coordinator. Direct packets never dispatch Coordinator; the
Orchestrator is the parent controller. Permit an explicit disabled choice.
Disabling Coordinator on a true direct packet is not a capability gap. A
wave that needs Coordinator while the route is omitted or disabled is a
typed capability gap, not silent Orchestrator substitution.

## Reverify

If you want Reverify and it is unavailable, onboard-bearing asks whether to
download and install it. Download happens only after explicit approval. If
you decline Reverify or decline its download, the named profile records
`reverify.enabled: false` and ordinary Lifecycles do not ask again. A later
explicit onboard-bearing configuration change may revisit the setting.

## Legacy lineup files

A leftover `~/.agents/bearing-lite/lineups.json` is not live configuration.
Runtime returns `MIGRATION_REQUIRED`. Migration validates the lineup, asks
which route to assign to Integration Engineer execution, writes a
semantically equivalent `profiles.json`, validates readback, then removes
`lineups.json`. Packaged catalogs never fall back to the old path.

## Clean-session

`planning_to_implementation_clean_session` is an explicit boolean. When
enabled, the planning Orchestrator renders a fresh implementation-start
handoff from the approved package after owner acceptance. When disabled, the
same Orchestrator continues from durable artifacts. An approved Lifecycle may
freeze an override in `implementation.json`.

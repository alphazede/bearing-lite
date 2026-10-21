# Onboarding Bearing Lite

Use this page after installing the plugin or copying `skills/`.

## First run

The agent prints the [welcome and opening question](../../skills/onboard-bearing/references/welcome.md)
from the shipped onboarding reference, then waits for your choice. Choose guided
onboarding, a targeted lineup change, recommended Lite setup, or Full setup.
Lite and Full are configuration starting points; they do not silently select
models, enable roles, or request review. Targeted edits skip the tour.

## Configure the selected profile

1. Confirm Node.js is on `PATH` if you will use hook adapters.
2. Invoke **onboard-bearing**.
3. Answer one setting at a time. The skill may recommend a value; it never
   selects or writes without your explicit instruction.
4. Unaddressed existing values stay unchanged.
5. Validate the resulting `~/.agents/bearing-lite/profiles.json` readback.

Before asking about a role, use the [role guide](roles.md) to explain its purpose,
outputs, and available sessions briefly. Ask whether it should be enabled; only
then collect its harness, model, reasoning, and ordered fallbacks. Explain cadence
when configuring an assessment session. The current Orchestrator and human owner
are explained in the guide but are not configurable specialist routes. Explain
unfamiliar terms when they arise rather than printing the entire glossary.

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

## Optional review and testing tools

The agent explains [OCR, Reverify, and additional testing tools](../../skills/onboard-bearing/references/verification-tools.md)
before asking for choices. All are optional; enabling a tool never requests an
independent review, authorizes execution, or silently installs software.

### OCR / OpenCodeReview coverage assist

An optional deterministic capability the Reviewer uses as its method: which
files are reviewable, which are excluded and why, and which rules apply. It
finds no defects and produces no verdict. Ask whether it is enabled and whether
it is required; permit an explicit disabled choice, which is not a capability
gap. Bearing Lite records only those two booleans under
`review.coverage_assist`. The capability keeps its own configuration in its own
tooling; onboard-bearing never selects credentials, providers, or models.

### Reverify

An optional tool for checking explicit verification claims and producing
candidate-bound evidence. It is used for applicable binary-level claims; it
does not replace the repository's tests. Ordinary source-only work does not
require a binary check.

If you want Reverify and it is unavailable, onboard-bearing asks whether to
download and install it. Download happens only after explicit approval. If
you decline Reverify or decline its download, the named profile records
`deterministic_verification.reverify.enabled: false` and ordinary Lifecycles do not ask again. A later
explicit onboard-bearing configuration change may revisit the setting.

### Additional testing tools

The agent asks whether you want repository test runners, linting, coverage,
mutation tests, security scans, or other checks. Choose the tools; provide their
repository commands, pass rules, and expected evidence. Entries are optional
under `deterministic_verification.additional_tools`, and can each be disabled.
Planning binds applicable commands into SEIT; approved task commands are then
run during implementation. There is no automatic execution or installation.
Existing profiles need no migration, and required project gates remain required.

## Legacy lineup files

A leftover `~/.agents/bearing-lite/lineups.json` is not live configuration.
Runtime returns `MIGRATION_REQUIRED`. Migration validates the lineup, asks
which route to assign to Integration Engineer execution only when enabled,
asks for a missing Test Implementer only in `tdd`, writes a
semantically equivalent `profiles.json`, validates readback, then removes
`lineups.json`. Packaged catalogs never fall back to the old path.

## Clean-session

`planning_to_implementation_clean_session` is an explicit boolean. When
enabled, the planning Orchestrator renders a fresh implementation-start
handoff from the approved package after owner acceptance. When disabled, the
same Orchestrator continues from durable artifacts. An approved Lifecycle may
freeze an override in `implementation.json`.

# Named profile catalog

Use this reference to read and select user-owned profiles. For explicitly
requested setup or edits, use [onboard-bearing](../../onboard-bearing/SKILL.md)
and its [guided setup](../../onboard-bearing/references/guided-first-profile.md).
Selection grants no execution authority. This is not a staged
profile or route-review gate.

## Location

The live user catalog is exactly one file:

`<absolute home>/.agents/bearing-lite/profiles.json`

Resolve `<absolute home>` as a nonempty absolute `HOME`, else a nonempty
absolute `USERPROFILE` on its platform; otherwise fail closed with
`home_unresolved`. Do not use cwd, the package root, XDG, a relative
`profiles.json`, or a second search root.

The packaged catalog is package-root `profiles.json`. Never read it as user
data. Never write the packaged catalog, including resolved symlink aliases
of that file.

Missing user file means no named profiles. Do not auto-create the live
catalog. An empty `profiles` object is valid and is not an error. A
malformed unused catalog cannot override explicit inline owner choices.

Runtime and skills never search, merge, prefer, or fall back to
`lineups.json`. A leftover user `lineups.json` is not live configuration;
return `MIGRATION_REQUIRED` until explicit migration validates it, writes
and validates a semantically equivalent `profiles.json`, and removes
`lineups.json`.

## Configurable roles

The Coordinator role is retired. Existing `roles.coordinator` entries are ignored
and not newly scheduled; they remain in frozen snapshots unchanged.

Catalog entries assign nested role/session routes for Product Implementer
(`implementer`), Test Implementer (`test_implementer`), Light
Implementer, Reviewer, Scribe, MBSE (`mbse`), Integration and Test
(`integration_test`), Test Engineer (`test_engineer`), and Integration Engineer
(`integration_engineer`). Every specialist role is optional; configuration
alone does not request independent review. MBSE and Integration and Test each
have a `planning` session; Test Engineer has an `assurance` session only (its
`planning` session is removed and refused); Integration Engineer has an
`execution` session only (its `planning` session is removed and refused).
`requirements_engineer` and `systems_modeler` role keys are removed and refused
with no alias. Each session can be enabled or disabled. Cadence keys attach to
`roles.test_engineer.sessions.assurance`, `roles.reviewer`, and
`roles.integration_engineer.sessions.execution`
with values `slice`, `phase`, or `lifecycle`. Defaults are `phase`, `phase`,
and `lifecycle`. `roles.scribe.cadence` is `event` (default: after each owner
decision, authority event, or landing), `phase`, or `lifecycle`; handoff and
closeout check history coverage at every Scribe cadence. Scribe is optional:
when omitted or disabled, Orchestrator records history; when enabled, reuse one
persistent Lifecycle session for all events and batches. The Light Implementer takes only slices whose `work_class`
is `light` (criteria in `skills/light-implementer`); it has its own primary
and fallbacks supplied by the owner. Surveyor, Explorer,
Crewmate, Navigator, Park Ranger, and Validator are not profile roles;
existing plans that still assign them use the compatibility diagnostics and
treat the assignment as unused. Never fill agent, model, or reasoning values
on the user's behalf.

Plan Integrator (`roles.plan_integrator`) and the interim separate Planning and
Design route (`roles.planning_and_design`) are retired. Final planning/design and
assembly are the Planning Orchestrator's own procedure, so neither key has a
consumer. `hooks/profiles.cjs` returns `MIGRATION_REQUIRED` with
`retired_role:<key>` and the profile name. Only an explicit owner request runs
migration through `onboard-bearing`: show the key, remove only that key, keep
every other role, model, fallback, cadence, and capability section unchanged,
validate readback, and never copy the retired route to another role or treat it
as the Orchestrator identity. Do not edit a live catalog without that request.

The Orchestrator is not a configurable role: it is whatever session is running
planning. The Lifecycle snapshot records the observed Orchestrator identity
(harness, model, reasoning at that time). A catalog or snapshot entry with
`role: Orchestrator` or `role: Router` is ignored with the typed note
`router_row_ignored`; it is never a deviation.

Only verified primary unavailability activates its approved fallback. If
both are unavailable, return `OWNER_DECISION_REQUIRED`.
Activation within the frozen ordered fallbacks is a dated execution receipt,
not a profile amendment or a new owner approval. Verify the approved activation
condition and remaining eligible routes before escalating exhaustion. A new
identity or changed fallback condition requires an owner amendment; follow
`owner-stops.md` for classification and batching.

This catalog is the single profile source. A legacy
`~/.agents/bearing-lite/default-role-lineup.md` is never read or created.
A missing catalog returns the typed outcome `no_named_profiles` and an
inline-selection prompt. A leftover
`~/.agents/bearing-lite/lineups.json` is ignored as live data with
`MIGRATION_REQUIRED`.

## Validity

Named selection and save require a valid catalog. Bind
`schemas/profiles.schema.json` Draft 2020-12 validation before named
selection or save. That schema is the validation document, not a second
search root for user data. Do not add a runtime catalog library.

On load and on save, inspect raw object members first. Reject duplicate
raw JSON keys; do not silently collapse. Then parse and apply Draft 2020-12
validation against package-root `schemas/profiles.schema.json`. Fail closed
as follows even when the schema cannot express the check:

- Reject duplicate role assignments within each phase or session.
- Reject ASCII case-fold collisions on both load and save. Do not trim
  or case-fold names.
- Defaults keys must resolve exactly. Unresolved defaults fail closed.
- Invalid structure or name fails closed on both load and save.
- Reject active Surveyor, Explorer, Crewmate, Navigator, Park Ranger, or
  Validator role keys, retired planning route keys (`plan_integrator`,
  `planning_and_design`), removed role keys (`requirements_engineer`,
  `systems_modeler`), and removed planning sessions (`test_engineer.sessions.planning`,
  `integration_engineer.sessions.planning`).

Refuse named selection or save on any of those failures. Do not invent a
fallback profile and do not read packaged bytes as user data.

## Selection

Explicit inline owner choices require no catalog lookup and no extra
confirmation. Consume them as already explicit.

A named choice needs a valid catalog and an exact selected key. Do not trim
or case-fold the name. Independent planning and implementation selections
remain separate; the owner may pick two names, one name twice, or inline on
either side.

Optional user `defaults.planning` and `defaults.implementation` are
recommendations requiring selection or confirmation. They are never a silent
grant and not an authority grant. Do not apply them without that
confirmation. Do not invent a packaged default.

Copy selected entries into the Lifecycle snapshot as a frozen snapshot copy.
Preserve fallback array order. Bind a SHA-256 configuration digest of that
frozen snapshot copy. Digest that copy only: selected entries with fallback
order and selection sources. Exclude N/K/C, review cadence, route, and
authority. Canonical JSON: UTF-8, sort_keys, compact separators.
Later catalog edits do not mutate the frozen snapshot copy or its digest.
For `tdd`, freeze both `test_implementer` and `implementer` routes and
fallback order into that frozen snapshot copy.
Preserve profile `holds` in the frozen snapshot and configuration digest, including
`coordinator-decisions` and `orchestrator-delegation`. Relevant Coordinator and
Orchestrator packets consume those frozen holds. Delegation defaults off and needs
explicit task authority; see `owner-stops.md#coordinator-escalation-and-delegation`.
An older snapshot missing selected holds requires explicit reconciliation before use.
Selected capability sections (`review`, `deterministic_verification`) are
frozen alongside routes, and relevant packets must consume that binding.
Optional `deterministic_verification.additional_tools` entries carry `name`,
`enabled`, `command`, `pass`, and `evidence`. Omitted/empty lists add nothing;
disabled entries stay inactive. Their actual commands and evidence are planning
inputs for applicable SEIT procedures, not automatic execution or installation
authority. Preserve them in the frozen snapshot; a live edit requires the same
explicit amendment as other capability changes. Required project gates remain
in force. Onboarding explains the choices in
`../../onboard-bearing/references/verification-tools.md`.
The parent controller declares Reviewer and assurance packets from that
frozen snapshot copy, never from the live catalog.
An optional profile `execution.live_wave` (`herdr` or `headless`) is likewise
copied into `snapshot.execution` and bound in the configuration digest
(`digest`, not `settings_digest`); omission keeps headless-by-omission and
leaves the digest unchanged. Planning and Design copies the frozen mode into
`journey_settings.live_wave` in `implementation.json`. A differing plan value
(an omitted plan value counts as `headless`) needs a recorded
`journey_settings.live_wave_owner_amendment` (`{from, to, owner_decision}`);
final freeze otherwise reports `live_wave_profile_mismatch`. Later catalog
edits to `execution` do not mutate the frozen snapshot.
OCR means OpenCodeReview via `coverage_assist`, not a new role or backend
hard dependency. Older roles-only snapshots need explicit reconciliation
or owner amendment, not live-catalog hot reload. Reconcile by re-freezing
the same named profile and comparing SHA-256 digests: equal digest means
the snapshot is current; unequal digest, or omitted `review` /
`deterministic_verification` on an otherwise selected profile, requires a
dated owner-confirmed visible amendment before packets consume a new
binding.

## Save

Save only on explicit owner request. Never save this Lifecycle as a side
effect of selection, freeze, or routing.

Create versus replace: if replace is already explicit, do not ask again;
otherwise preview the selected-entry replacement and confirm. Create must
not overwrite an existing exact key. Replace updates only that key.

Preserve unrelated valid keys and defaults. Refuse changed-input overwrite.
Use a safe atomic update (sibling temp file, then rename).

Do not write N/K/C, review cadence, route, or authority into catalog
entries.

## Development strategy, cadence, concurrency, clean-session

`development_strategy.mode` is `single_implementer` (speed default) or
`tdd`. `tdd` orders Test Implementer before Product Implementer for a
behavior-changing slice. There is no parallel Test Implementer/Product
Implementer mode for one feature; same-feature parallel is prohibited.
Independent dependency-ready slices may run concurrently when write sets
and mutable resources do not overlap. `single_implementer` stays valid
with no `test_implementer` field; a present Test Implementer route is
ignored.

Selecting, freezing, dispatching, or migrating a `tdd` profile with a
missing, disabled, or malformed `test_implementer` or `implementer` route returns
`OWNER_DECISION_REQUIRED` and an onboard prompt. Never copy from Product
Implementer (`roles.implementer`), Test Engineer (`test_engineer`), Light
Implementer (`light_implementer`), or a retired role.

`planning_to_implementation_clean_session` is an explicit boolean with no
preselected value. At planning selection, carry the frozen
`lifecycle_settings` and `settings_digest` with the binding. Set
`journey_settings.planning_to_implementation_clean_session` from the profile
or the approved task override in `implementation.json`.

## Migration

Migration preserves meaning from `planned_planning_assignments` and
`implementation_assignments`. Map Crewmate to Implementer, Park Ranger to
Reviewer, and keep Light Implementer unchanged. Report Explorer as retired
and retain any already-frozen Coordinator assignment on its pinned runtime. Map Test
Engineer planning-phase rows to `roles.integration_test.sessions.planning`, and
implementation-phase rows to `roles.test_engineer.sessions.assurance`. Do not auto-assign
Integration Engineer execution from Surveyor; if that optional session is enabled,
onboard-bearing asks which route to assign. Migration asks for a missing Test
Implementer route only in `tdd`; it never copies or invents `test_implementer` from Product
Implementer, Test Engineer, Light Implementer, or a retired role.
Validate the new profile, then remove `lineups.json`.
For obsolete `roles.fellow` entries, follow
[catalog Fellow migration](../../onboard-bearing/references/catalog-contract.md#move-a-former-profile-fellow).

## Route effort and Fellow

The Orchestrator uses the session the owner opens. The owner supplies all
harness, model, and reasoning identities, including the optional
catalog-level `fellow` route.

Only the Orchestrator [consults the Fellow](consultation.md), whatever profile
is selected. `fellow` is an optional Bearing-level route at the top level of
`profiles.json` beside `profiles` (`{ harness, model, reasoning,
ordered_fallbacks }`, with optional `condition` on each fallback entry), not a
key under `roles`. Every freeze copies catalog `fellow` unchanged into
`snapshot.fellow` and binds it into the configuration digest; when the catalog
omits `fellow`, `snapshot.fellow` is absent and the Orchestrator proceeds
without Fellow consultation.

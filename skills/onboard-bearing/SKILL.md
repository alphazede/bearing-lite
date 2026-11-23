---
name: onboard-bearing
description: >
  Create, edit, or migrate a Bearing profile or catalog setting on explicit
  owner request. Use for guided first-profile setup and targeted configuration
  changes in profiles.json. Ordinary task dispatch, installing a skill, and a
  missing profile do not authorize catalog writes. Collect route choices from
  the owner and keep credentials outside the catalog.
---

# onboard-bearing

Classify `profiles.json` first and ask one setting at a time.
Honor a supplied mode or target edit first; for an open first-run or
walkthrough, print the welcome and opening question verbatim from
`references/welcome.md` (guided first-profile path in
`references/guided-first-profile.md`, existing-profile edit, Lite, or Full).
Explain each active role from its sibling `SKILL.md` (`mbse` and
`integration_test` for planning; `test_engineer` assurance and
`integration_engineer` execution only, with their legacy planning sessions
removed and refused) and catalog-level `fellow` from
`../bearing-lite/references/consultation.md`. Targeted edits skip the tour.
Explain settings without selecting or writing unless explicitly instructed.
Preserve unaddressed values. The owner supplies every
harness, model, and reasoning level. Bearing never fills, suggests, ranks, or
characterizes route identities.
Loop: classify → choices → editable preview → validate → atomic save →
validate readback → optional consented launch probe → return.

## Inputs and match

- **Match:** owner-requested first-run setup, configuration change, or migration; a missing profile alone never authorizes writes.
- **Non-match:** ordinary Lifecycle dispatch, silent repair of a valid profile.

## Algorithm

1. Resolve `<absolute home>/.agents/bearing-lite/profiles.json` per
   `../bearing-lite/references/profiles.md` and `references/catalog-contract.md`.
   Refuse packaged `profiles.json` and symlink aliases. Never read packaged
   bytes as user data. Never search, merge, prefer, or fall back to `lineups.json`.
   Run the read-only validator (`scripts/validate-profiles.mjs`
   with `references/profiles.schema.json`, plus `evaluateCatalogState` /
   `validateCatalog` from `hooks/profiles.cjs` when available) first.
2. If user `lineups.json` exists, return `MIGRATION_REQUIRED` and never treat
   it as live configuration. Follow `references/catalog-contract.md`: validate
   the lineup semantically; ask which route to assign to Integration Engineer execution
   only if enabled; ask for a missing Test Implementer only in `tdd`
   (never copy or invent its route); compare colliding profiles when
   `profiles.json` exists; write `profiles.json`, validate readback, then remove
   `lineups.json`. Never auto-assign Surveyor or any retired role. Retired
   `roles.plan_integrator` or `roles.planning_and_design` also returns
   `MIGRATION_REQUIRED` (final planning/design is the Planning Orchestrator's
   own procedure): on explicit request, show and remove only that key while
   preserving all other roles, models, fallbacks, capabilities, and
   host-extension-owned keys; never copy its route. Legacy
   `roles.requirements_engineer`, `roles.systems_modeler`,
   `roles.test_engineer.sessions.planning`, and
   `roles.integration_engineer.sessions.planning` are removed and refused.
   If a former `roles.fellow` appears, follow the
   [catalog Fellow migration](references/catalog-contract.md#move-a-former-profile-fellow)
   on explicit request.
3. For guided first-profile setup, follow `references/guided-first-profile.md`
   (optional presence check for an owner-named tool, owner-supplied route
   identities, and separate labels `tool found`, `model offered`,
   `launch tested`; role/profile usage explanation; editable one-row-per-change
   preview; opt-in launch probe with consent per run; copyable next request).
   Ask settings one at a time in the ordered checklist below within scope, with
   no preselected value; skip supplied, unchanged, or inapplicable choices.
   Never ask a setting that has no key in `schemas/profiles.schema.json`
   (planning review is per-Lifecycle at `journey_settings.planning_wave.review_requested`,
   not in `profiles.json`; Orchestrator model/effort come from the opened session):
   1. **Catalog Fellow (`fellow`):** optional Bearing-level top-level route
      beside `profiles` (`{ harness, model, reasoning, ordered_fallbacks }` with
      optional fallback `condition`, explained from
      `../bearing-lite/references/consultation.md`, never under `roles`; show
      read-only if already set unless a catalog-wide edit is requested).
   2. **Profile name (`profiles.<name>`) and destination:** exact key matching
      `^[A-Za-z][A-Za-z0-9_-]*$`, no ASCII case-fold collisions; confirm create
      vs. edit vs. replace.
   3. **Development strategy (`development_strategy.mode`):** `single_implementer`
      or `tdd`. Collect before author routes.
   4. **Role and session routes (`roles.*`):** required roles
      (`roles.implementer`, plus `roles.test_implementer` when
      `development_strategy.mode` is `tdd`) skip the enable question (`enabled:
      true`) and go straight to collecting `primary` (`{ harness, model,
      reasoning }`) and `ordered_fallbacks` (`[{ condition, harness, model,
      reasoning }]`). Optional roles and sessions keep the enable question: for
      enabled routes collect `enabled: true`, `primary`, `ordered_fallbacks`,
      and `cadence`; for a fresh explicit decline save `{ "enabled": false }`
      (or `sessions.<session>: { "enabled": false }`); when disabling an
      existing route preserve its `primary`/`ordered_fallbacks`; omit deferred
      roles:
      - `roles.implementer` (Product Implementer; required enabled for
        implementation profiles)
      - `roles.test_implementer` (Test Implementer; required with `enabled: true`
        when `development_strategy.mode` is `tdd`, collected independently of
        Product Implementer `roles.implementer`; missing/disabled/malformed
        `test_implementer` or `implementer` returns `OWNER_DECISION_REQUIRED`
        with an onboard prompt; must ask and never copy or invent from Product
        Implementer, Test Engineer, Light Implementer, or a retired role;
        `single_implementer` stays valid without `test_implementer`)
      - `roles.light_implementer` (Light Implementer for `work_class: light`)
      - `roles.mbse.sessions.planning` (MBSE planning; `requirements_engineer`
        and `systems_modeler` are refused)
      - `roles.integration_test.sessions.planning` (Integration and Test
        planning; replaces removed `test_engineer`/`integration_engineer`
        `planning` sessions)
      - `roles.test_engineer.sessions.assurance` (`cadence`: `slice` | `phase`
        | `lifecycle`; `test_engineer.sessions.planning` is refused)
      - `roles.integration_engineer.sessions.execution` (`cadence`: `slice` |
        `phase` | `lifecycle`; `integration_engineer.sessions.planning` is
        refused)
      - `roles.reviewer` (`cadence`: `slice` | `phase` | `lifecycle`;
        configuring it does not request review for a task)
      - `roles.scribe` (`cadence`: `event` | `phase` | `lifecycle`; Orchestrator
        records history when omitted/disabled; enabled Scribe keeps one
        persistent Lifecycle session)
      - *(Coordinator note: the Implementation Orchestrator owns
        coordination for independent packets, shared wave evidence and
        aggregate repair ownership.
        Existing Coordinator routes are ignored for new work; do not newly
        configure `roles.coordinator`. Preserve frozen legacy assignments per
        `../bearing-lite/references/coordinator-migration.md`.)*
      - *(First-task planning rules: see `../mbse/SKILL.md`,
        `../integration-test/SKILL.md`, and `references/catalog-contract.md`.)*
   5. **Clean session (`planning_to_implementation_clean_session`):** explicit
      boolean (`true`: fresh `handoff.md`; `false`: continue from durable
      artifacts).
   6. **Concurrency (`concurrency`):** two booleans only (never numeric):
      `concurrency.dispatch_ready_independent_work` and
      `concurrency.preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources`.
   7. **Review capability (`review.coverage_assist`):** explain all four
      `enabled`/`required` states via `references/verification-tools.md`; write
      both `false` when explicitly turned off; explicit disabled is not a gap.
   8. **Deterministic verification (`deterministic_verification`):** explain
      Reverify availability, separate install consent, and
      `deterministic_verification.reverify.enabled` (decline records
      `reverify.enabled: false`) plus `deterministic_verification.additional_tools`
      (`name`, `enabled`, and when enabled `command`, `pass`, `evidence`).
   9. **Assurance repair (`assurance_repair.enabled`):** optional boolean in
      Full setup/assurance edits preauthorizing one bounded test-side repair.
   10. **Holds (`holds`):** array of `{ id, effect, ... }` objects. For
       delegation use `../bearing-lite/references/owner-stops.md` and
       `orchestrator-delegation` in `holds`, disabled unless explicitly enabled
       (enabled mode needs scoped task authority, exclusions, expiry).
   11. **Catalog defaults (`defaults`):** optional `defaults.planning`,
       `defaults.implementation` resolving to exact profile keys; never silent.
   12. **Default execution mode (`execution.live_wave`):** ask whether to use
       `herdr` or `headless` when creating a profile or editing this setting.
       Leave the field absent if deferred on create. Preserve it on unrelated edits.
4. Validate before/after write and preserve extension keys losslessly:
   - **Pre-write:** run `scripts/validate-profiles.mjs --stdin` (using
     `references/profiles.schema.json` / `schemas/profiles.schema.json` and
     declared extension paths) and `validateCatalog` / `freezeSelectedRoutes`
     from `hooks/profiles.cjs` when available. Check raw JSON duplicate keys,
     `schema_version: 1`, case-fold uniqueness, `defaults`, and retired/removed
     keys. Stop before editing on undeclared unknown keys.
   - **Preserve host extension keys and unaddressed fields:** patch only
     approved paths so unaddressed profiles, settings, and host-extension-owned
     keys stay intact.
   - **Atomic write:** verify disk bytes did not change concurrently, then write
     via sibling temp file and rename. Store no credentials or unrequested
     backups.
   - **Readback:** run `scripts/validate-profiles.mjs --catalog <path>` plus
     `evaluateCatalogState`, `freezeSelectedRoutes`, and
     `evaluateTddTestImplementerRoute` (for `tdd`) from `hooks/profiles.cjs` to
     confirm `READY`/`VALID` and preserved extension keys.

## Return and recovery
For a request outside setup, targeted edits, or explicit migration, return
`NO_MATCH` and leave the catalog untouched. After cancellation, stop the
interview and leave it untouched. After detecting a concurrent edit, return
`NEEDS_MORE_EVIDENCE`; reclassify from disk on the owner's next request.

Return `READY`, `MIGRATION_REQUIRED`, `no_named_profiles`, `NEEDS_MORE_EVIDENCE`,
or `OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests,
findings, and blocker, reporting `catalog_valid`, `strategy_readiness`, and
`route_test_status` separately (`tool found`, `model offered`, `launch tested`).

Never invent a setting, write the packaged catalog, or keep a lineup fallback.

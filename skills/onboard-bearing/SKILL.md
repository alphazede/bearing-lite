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
For first-run or a requested walkthrough, print the welcome and opening question verbatim from `references/welcome.md`; offer its Lite/Full starting points. Explain each active role from its canonical sibling `SKILL.md` under `skills/` before configuring it (`mbse` and `integration_test` for planning; `test_engineer` assurance and `integration_engineer` execution only, with their legacy planning sessions removed and refused). Targeted edits skip the tour and ask only missing choices.
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
   preserve every other role, model, fallback, capability, and host-extension-owned key; never copy its route.
   Legacy `roles.requirements_engineer`, `roles.systems_modeler`,
   `roles.test_engineer.sessions.planning`, and
   `roles.integration_engineer.sessions.planning` keys are removed and refused (3.0 is unreleased; there is no alias).
3. Ask settings one at a time in the ordered checklist below within the requested
   scope, with no preselected value; skip supplied, unchanged, or inapplicable
   choices (for example, skip `roles.test_implementer` when
   `development_strategy.mode` is `single_implementer`). Never ask a setting
   that has no key in `schemas/profiles.schema.json` (planning review is
   requested per Lifecycle, not stored in `profiles.json`; Orchestrator model
   and reasoning effort come from the session the owner opens, not a catalog
   key):
   1. **Catalog Fellow (`fellow`):** optional Bearing-level route once at the
      top level of `profiles.json` beside `profiles` (`fellow`: `{ harness,
      model, reasoning, ordered_fallbacks }` with optional `condition` per
      fallback, explained from `../bearing-lite/references/consultation.md`,
      never placed under profile `roles`; omitting it is valid and skips
      Fellow consultation).
   2. **Profile name (`profiles.<name>`):** exact profile key matching
      `^[A-Za-z][A-Za-z0-9_-]*$` with no ASCII case-fold collisions; confirm
      create vs. replace on an existing name.
   3. **Development strategy (`development_strategy.mode`):** `single_implementer`
      or `tdd`. Collect this before role routes so `tdd` collects Test
      Implementer independently.
   4. **Role and session routes (`roles.*`):** every specialist role is
      optional; collect `enabled` (boolean), `primary` (`{ harness, model,
      reasoning }`), `ordered_fallbacks` (`[{ condition, harness, model,
      reasoning }]`), and `cadence` where supported:
      - `roles.implementer` (Product Implementer)
      - `roles.test_implementer` (Test Implementer; required with `enabled: true`
        when `development_strategy.mode` is `tdd`, collected independently of
        Product Implementer `roles.implementer`; a missing, disabled, or
        malformed route returns `OWNER_DECISION_REQUIRED` with an onboard
        prompt; must ask for the missing Test Implementer and never copy or
        invent a route from Product Implementer, Test Engineer, Light
        Implementer, or a retired role; `single_implementer` stays valid with
        no `test_implementer` field)
      - `roles.light_implementer` (Light Implementer for `work_class: light` slices)
      - `roles.mbse.sessions.planning` (MBSE planning; replaces
        `requirements_engineer` and `systems_modeler`, which are refused)
      - `roles.integration_test.sessions.planning` (Integration and Test
        planning; replaces the removed `planning` sessions of `test_engineer`
        and `integration_engineer`)
      - `roles.test_engineer.sessions.assurance` (Assurance Test Engineer, with
        optional `cadence`: `slice` | `phase` | `lifecycle`;
        `roles.test_engineer.sessions.planning` is removed and refused)
      - `roles.integration_engineer.sessions.execution` (Integration Engineer
        execution, with optional `cadence`: `slice` | `phase` | `lifecycle`;
        `roles.integration_engineer.sessions.planning` is removed and refused)
      - `roles.reviewer` (Reviewer, with optional `cadence`: `slice` | `phase`
        | `lifecycle`; configuring a Reviewer does not request review for a task)
      - `roles.scribe` (Scribe, with optional `cadence`: `event` | `phase` |
        `lifecycle`; explain Orchestrator transcription as the default when
        Scribe is omitted or disabled; an enabled Scribe uses one persistent
        Lifecycle session and resumes from its receipt after a genuine reset)
      - *(Coordinator note: the Implementation Orchestrator owns
        coordination for independent packets, shared wave evidence and
        aggregate repair ownership.
        Existing Coordinator routes are ignored for new work; do not newly
        configure `roles.coordinator`. Preserve frozen legacy assignments as
        described in `../bearing-lite/references/coordinator-migration.md`.)*
   5. **Clean session (`planning_to_implementation_clean_session`):** explicit
      boolean with no preselected value.
   6. **Concurrency (`concurrency`):**
      `concurrency.dispatch_ready_independent_work` (boolean) and
      `concurrency.preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources`
      (boolean).
   7. **Review capability (`review.coverage_assist`):** use
      `references/verification-tools.md` to explain OCR and ask whether
      `review.coverage_assist.enabled` and `review.coverage_assist.required` are
      enabled/required; an explicit disabled choice is not a gap; its provider,
      model and credentials stay in its tooling.
   8. **Deterministic verification (`deterministic_verification`):** use
      `references/verification-tools.md` to explain Reverify and optional extra
      testing tools: `deterministic_verification.reverify.enabled` (declining
      Reverify or its download persists
      `deterministic_verification.reverify.enabled: false` for that named
      profile) and `deterministic_verification.additional_tools` (`name`,
      `enabled`, and when enabled `command`, `pass`, `evidence`).
   9. **Assurance repair (`assurance_repair.enabled`):** optional boolean
      preauthorizing one bounded same-session repair of proven test-side
      defects per assurance round (`false` or omitted means no repair
      preauthorization).
   10. **Holds (`holds`):** optional array of `{ id, effect, ... }`. For a
       requested bounded delegation hold, use `../bearing-lite/references/owner-stops.md`.
       Store `orchestrator-delegation` in `holds`,
       disabled unless explicitly enabled. Enabled mode needs scoped task
       authority, exclusions and expiry, preserves protected actions and
       review/repair limits, and carries frozen decision holds into packets.
   11. **Catalog defaults (`defaults`):** optional recommendations at the top
       level beside `profiles` (`defaults.planning`, `defaults.implementation`),
       each resolving to an exact key in `profiles`; never a silent grant.
4. Preserve explicit personal preferences. Save explicit enabled/disabled
   choices and validate without stripping host-extension-owned keys:
   - **Pre-write checks:** inspect raw JSON for duplicate keys, confirm
     `schema_version: 1`, check profile names and ASCII case-fold uniqueness,
     verify any `defaults.planning` / `defaults.implementation` values resolve
     to exact profile keys, and refuse retired/removed role or session keys.
     Validate Bearing Lite-owned fields against `schemas/profiles.schema.json`
     (Draft 2020-12) by projecting Bearing Lite's schema keys rather than
     failing on or stripping unknown keys owned by a host extension.
   - **Preserve host-extension keys and unaddressed fields:** merge authorized
     edits into the existing catalog object so unaddressed profiles, unaddressed
     settings, and keys owned by a host extension (at the catalog, profile,
     role, or hold level) remain intact.
   - **Atomic write:** write only authorized choices atomically (sibling temp
     file, then rename). Store no credentials or unrequested backups.
   - **Readback verification:** re-read `profiles.json` and call
     `evaluateCatalogState` and `freezeSelectedRoutes` (plus
     `evaluateTddTestImplementerRoute` for `tdd` profiles) from
     `hooks/profiles.cjs` to confirm `outcome: "READY"` and a clean freeze
     binding, while verifying host-extension-owned keys and unaddressed entries
     were preserved verbatim.

## Return and recovery
Return `READY`, `MIGRATION_REQUIRED`, `no_named_profiles`, or `OWNER_DECISION_REQUIRED` with verdict, candidate_ref, changed_paths, tests, findings, and blocker.

Never invent a setting, write the packaged catalog, or keep a lineup fallback.

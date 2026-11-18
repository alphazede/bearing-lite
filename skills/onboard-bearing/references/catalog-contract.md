---
type: agent-reference
title: Profile Catalog Field Map, Validation, and Recovery
tags: [bearing, onboarding, catalog, schema]
---

# Profile Catalog Field Map, Validation, and Recovery

Authoritative field map and recovery rules for `skills/onboard-bearing` on
Bearing Lite 3.0.0-rc.2. Always verify against `references/profiles.schema.json`
(synced with `schemas/profiles.schema.json`) and `scripts/validate-profiles.mjs`.

## 1. Exact catalog field map (R19)

| Path | Type / Shape | Notes |
| --- | --- | --- |
| `schema_version` | integer `1` | String `"1"` is invalid (R09). |
| `profiles.<name>` | object (`^[A-Za-z][A-Za-z0-9_-]*$`) | Case-sensitive exact key; ASCII case-fold collisions are rejected. |
| `fellow` | `{ harness, model, reasoning, ordered_fallbacks }` | Top-level only (beside `profiles`), optional; `ordered_fallbacks` entries have `{ harness, model, reasoning, condition? }`. Never under `roles.fellow`. Omission disables Fellow consultation. |
| `defaults` | `{ planning?, implementation? }` | Optional; each value must match an exact key in `profiles`. Never a silent grant. |
| `profiles.<name>.roles` | object (required on profile) | Closed Bearing Lite role keys below. |
| Direct roles | `implementer`, `test_implementer`, `light_implementer`, `coordinator` (legacy ignored) | `{ enabled: boolean, primary?: { harness, model, reasoning }, ordered_fallbacks?: [{ condition, harness, model, reasoning }] }`. |
| `roles.reviewer` | direct route + optional `cadence` | `cadence`: `"slice" \| "phase" \| "lifecycle"` (default `"phase"`). |
| `roles.scribe` | direct route + optional `cadence` | `cadence`: `"event" \| "phase" \| "lifecycle"` (default `"event"`). |
| `roles.mbse.sessions.planning` | nested session route | Replaces removed `requirements_engineer` and `systems_modeler`. |
| `roles.integration_test.sessions.planning` | nested session route | Replaces removed `test_engineer.sessions.planning` and `integration_engineer.sessions.planning`. |
| `roles.test_engineer.sessions.assurance` | nested session + optional `cadence` | `cadence`: `"slice" \| "phase" \| "lifecycle"` (default `"phase"`). |
| `roles.integration_engineer.sessions.execution` | nested session + optional `cadence` | `cadence`: `"slice" \| "phase" \| "lifecycle"` (default `"lifecycle"`). |
| `development_strategy` | `{ mode: "single_implementer" \| "tdd" }` | Collect before author routes. `tdd` requires both `test_implementer` and `implementer` enabled for freeze/dispatch (R12). |
| `planning_to_implementation_clean_session` | `boolean` | `true`: fresh `handoff.md` for a new Implementation Orchestrator session; `false`: continue in the same Orchestrator from durable artifacts (R10). |
| `concurrency` | `{ dispatch_ready_independent_work?: boolean, preserve_order_for_dependencies_interfaces_write_overlap_and_shared_mutable_resources?: boolean }` | Only these two booleans are allowed; numeric caps fail schema (R19). |
| `review.coverage_assist` | `{ enabled: boolean, required?: boolean }` | Four states (R18); write both `false` when turning coverage off. |
| `deterministic_verification.reverify` | `{ enabled: boolean }` | `false` saves an explicit Reverify decline (R22). |
| `deterministic_verification.additional_tools` | array of `{ name, enabled, command?, pass?, evidence? }` | `enabled: true` requires `command`, `pass`, `evidence`; `enabled: false` needs only `name` and `enabled`. |
| `assurance_repair` | `{ enabled: boolean }` | Preauthorizes one bounded same-session test-side repair per assurance round (R16). |
| `holds` | array of `{ id, effect, ... }` | Must be objects, never bare strings (R17). Example: `{"id":"orchestrator-delegation","effect":"Scoped delegation only","enabled":false}`. |

Minimal valid catalog example (single profile, one enabled author, empty fallbacks):

```json
{
  "schema_version": 1,
  "profiles": {
    "Starter": {
      "roles": {
        "implementer": {
          "enabled": true,
          "primary": { "harness": "example-harness", "model": "example-model", "reasoning": "example-effort" },
          "ordered_fallbacks": []
        }
      },
      "development_strategy": { "mode": "single_implementer" }
    }
  }
}
```

### Explicit decline vs. omission vs. disabling an existing route (R02)

- **Fresh explicit decline:** save `{ "enabled": false }` (or
  `{ "sessions": { "<session>": { "enabled": false } } }`) with no invented
  `primary` or `ordered_fallbacks`.
- **Disabling an existing complete route:** preserve its existing `primary` and
  `ordered_fallbacks` and flip `enabled` to `false`.
- **Deferred / unasked role:** omit the key completely.

### Task-only settings and route digest vs. `lifecycle_settings` (R03, R10, R14)

- **Never stored in `profiles.json`:** `journey_settings.planning_wave.review_requested`
  (R03), `rolling batch` boundaries (R14), `N/K/C`, `route`, `authority`, and
  Orchestrator model/effort (`roles.orchestrator` is invalid; the controller uses
  the session the owner opens, observed at start, and never auto-lowers effort, R08).
- **Route digest vs. `lifecycle_settings` (R10):** `hooks/profiles.cjs`
  `freezeSelectedRoutes` computes `digest` over `roles`, `fellow`, `review`,
  `deterministic_verification`, `assurance_repair`, and `holds` (excluding
  `cadence`, `route`, `authority`), and separately returns `lifecycle_settings`
  (`development_strategy`, `planning_to_implementation_clean_session`,
  `concurrency`, `selection_source`) with `settings_digest`. Equal route
  digests alone do not prove non-route lifecycle settings or cadences are unchanged.

## 2. Read-only validation and lossless extension handling (R01, R04, R09)

- **Named standalone validator (works in skills-only and full installs):**
  - Validator: `node <onboard-bearing-dir>/scripts/validate-profiles.mjs`
  - Schema: `<onboard-bearing-dir>/references/profiles.schema.json` (synced with
    `schemas/profiles.schema.json`; fail closed if missing)
  - Inputs: `--catalog <path>` (or default home catalog) or `--stdin` (candidate
    JSON before write); optional `--allow-extension <path,...>` /
    `--extension-schema <file>` for versioned host extensions.
  - Output: JSON `{ outcome, catalog_valid, empty_catalog, route_test_status, errors, diagnostics, strategy_readiness, preserved_extensions }`.
- **Full-repo hooks:** `hooks/profiles.cjs` exports `evaluateCatalogState`
  (presence/migration/top-level classifier), `validateCatalog` (full schema +
  semantic validator), `evaluateStrategyReadiness`, `evaluateTddTestImplementerRoute`,
  and `freezeSelectedRoutes`.
- **Lossless extension handling (R01):** When a catalog carries declared
  host-extension keys (for example `profile.assurance`,
  `profile.review.ocr_execution_mode`, `catalog.host_extension_meta`, or
  `profile.ext_routing`), validate Bearing Lite-owned keys against
  `profiles.schema.json` while passing the declared extension paths via
  `--allow-extension` / `--extension-schema` (or host extension schema).
  Preserve extension keys byte-identically on patch; never strip them and never
  accept undeclared arbitrary keys. If an unknown key has no declared extension
  owner, stop before changing a byte.

## 3. Classifier outcomes and read-only recovery (R09, R15, R20)

| Outcome / Reason | Meaning and recovery |
| --- | --- |
| `no_named_profiles` (`missing_user_catalog`) | No user `profiles.json`; ask before creating. |
| `READY` / `VALID` (`profiles: {}`) | Valid empty catalog; ask for a new profile name to create one. |
| `READY` (`retired_role_ignored: coordinator`) | Legacy `roles.coordinator` ignored for new waves; Implementation Orchestrator owns new waves (R11, R17). |
| `MIGRATION_REQUIRED` (`legacy_lineups_present`, `legacy_lineups_field`, `retired_role:plan_integrator`, `retired_role:planning_and_design`) | Stop ordinary setup and run explicit migration (below). |
| `NEEDS_MORE_EVIDENCE` (`home_unresolved`, `packaged_catalog_alias`, `duplicate_raw_json_key`, `catalog_not_json`, `invalid_schema_version`, `profiles_not_object`, `invalid_profile_name`, `profile_name_collision`, `dangling_default`, `malformed_fellow`, `retired_role:*`, `removed_role:*`, `removed_session:*`) | Report exact reason and path; never overwrite malformed bytes automatically. Require explicit owner repair or removal of the invalid entry. |
| `OWNER_DECISION_REQUIRED` (TDD `test_implementer` or `implementer` missing/disabled/malformed) | Catalog loads `READY`, but freeze/dispatch stops until the owner supplies both enabled TDD authors (R12). |

## 4. Migration when `lineups.json` or retired keys exist (R11, R15)

1. Validate `lineups.json` semantically (schema version, non-empty roles/routes).
   Never treat `lineups.json` as live configuration.
2. Map legacy entries cleanly without inventing routes:
   - `Crewmate` -> `roles.implementer`
   - `Park Ranger` -> `roles.reviewer`
   - `Light Implementer` -> `roles.light_implementer`
   - `Test Engineer` planning-phase -> `roles.integration_test.sessions.planning`;
     implementation-phase -> `roles.test_engineer.sessions.assurance`
   - `Explorer` -> `roles.coordinator` (preserved only as ignored legacy data for
     frozen journeys; never scheduled on new waves)
   - `Surveyor` -> never auto-assigned to `integration_engineer.sessions.execution`;
     ask the owner only if execution assessment is enabled.
   - `tdd` missing `test_implementer` -> ask the owner; never copy from another role.
   - Retired `plan_integrator` / `planning_and_design` -> show and remove only
     that key on explicit request; preserve all other keys.
3. **If `profiles.json` already exists beside `lineups.json` (R15):** validate
   existing `profiles.json`, compare each proposed migrated profile against
   existing entries, stop and confirm on any colliding profile key, and merge
   without losing unrelated profiles, defaults, or extension keys.
4. Validate the candidate with `validate-profiles.mjs --stdin`, write
   `profiles.json` atomically, validate readback (`validate-profiles.mjs` +
   `evaluateCatalogState` + `freezeSelectedRoutes`), and **only then** remove
   `lineups.json`.

## 5. First-task planning and handoff links (R06, R13, R17)

- Before authoring a first Lifecycle plan with a newly configured team, read
  `../mbse/SKILL.md`, `../integration-test/SKILL.md`, and
  `../planning-and-design/references/artifact-grammar.md` for `plan-package.cjs`
  rules (`procedure.actor === slice.role`, `work_class: "light"` requires
  `role: "Light Implementer"` + `work_class_reason` + non-empty `command_ids`,
  and reserved `step` / `integration_step` / `integration_step_id` / `step_id` /
  `integration_steps` / `requires` keys on slices).
- Repeated author reconciliations and session reuse are governed by
  `../planning-and-design/references/correction-loop.md` (R13; no profile key
  bounds them).
- Holds policy (`../bearing-lite/references/owner-stops.md`): new waves belong
  to the Implementation Orchestrator (frozen legacy Coordinator waves keep
  their pinned runtime until handover), and repair allowances are bounded per
  declared unit (`max_assurance_rounds: 1`).

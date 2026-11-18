---
type: agent-reference
title: Guided First-Profile Path
tags: [bearing, onboarding, guided]
---

# Guided First-Profile Path

This path helps an owner create or configure a named profile in
`~/.agents/bearing-lite/profiles.json` step by step without guessing schemas or
hidden fields.

**Strict neutrality rule (public package):** Bearing never fills, suggests,
ranks, or characterizes any harness, model, or reasoning level, never prints
tier tables or capability-cost advice, and never frames `fellow` or any role by
cost. The owner supplies every harness, model, and reasoning identity.

## Step 0 — Classify the catalog first

1. Resolve `<absolute home>/.agents/bearing-lite/profiles.json` (`HOME`, else
   platform `USERPROFILE`; fail closed on `home_unresolved`). Refuse the
   packaged `profiles.json` or any symlink alias resolving to it.
2. Run the named read-only validator (`scripts/validate-profiles.mjs`) on the
   resolved path (and `evaluateCatalogState` from `hooks/profiles.cjs` when
   available) before proposing any change.
3. Branch on the classified state:
   - `NO_NAMED_PROFILES` (`no_named_profiles`): no file yet; do not create one
     without explicit owner save approval.
   - `VALID` with `empty_catalog: true`: valid empty map (`{"schema_version":1,"profiles":{}}`);
     ready to create a named profile.
   - `VALID` with existing profiles: distinguish creating a new key, editing an
     existing key, or replacing an existing key. Never overwrite an existing key
     without explicit confirmation.
   - `MIGRATION_REQUIRED` (`lineups.json`, embedded `lineups`, or retired
     `plan_integrator` / `planning_and_design`): stop starter setup and run the
     explicit migration workflow (`references/catalog-contract.md#migration`).
   - `INVALID` (`duplicate_raw_json_key`, `catalog_not_json`,
     `invalid_schema_version`, `profile_name_collision`, `dangling_default`,
     `malformed_fellow`, removed rc.1 roles/sessions, or schema errors): report
     the exact error and stop before changing a byte unless the owner explicitly
     authorizes fixing that defect. If the catalog carries host-extension keys
     (such as profile `assurance` or `review.ocr_execution_mode`), follow
     `references/catalog-contract.md#lossless-extensions`.
4. Honor an already-supplied request or mode immediately (e.g. a named target
   edit skips the starter tour).

## Step 1 — Discover tools by local presence and ask consent

1. **Local presence first (read-only):** inspect which supported CLI binaries
   are present on `PATH` (without reading credentials, triggering installs, or
   making network/account calls). Distinguish a real executable from a missing
   CLI, a dead shim (e.g., `copilot` exiting 127), or an editor-only UI.
2. **Ask consent before any query:** show which tools were found locally and ask
   which tools Bearing may use and whether Bearing may run a read-only local
   model-listing command where supported. Zero usable tools is a valid stopping
   point—stop cleanly without inventing a profile.
3. **Per-harness model discovery or manual entry:** only for owner-consented
   tools:
   - **Codex:** `codex debug models` (or `--bundled` offline) lists local
     candidate IDs; does not establish account entitlement or effort.
   - **Cursor Agent CLI:** `agent models` / `agent --list-models` requires
     sign-in; if unauthenticated or unavailable, report "installed, account list
     unavailable" and use manual entry.
   - **AGY:** `agy models` (bounded timeout, preserving exact wrapper/command
     name such as `agy` vs `agy2`); fall back to manual entry on timeout/error.
   - **Muse Code:** `muse model-profile show <model> --effort <tier>` inspects a
     known model ID only (no enumerate-all command) -> use manual entry.
   - **Pi:** `pi --list-models` when `pi` is installed.
   - **Claude Code, DeepCode, editor-only integrations (Cursor editor, GitHub
     Copilot in VS Code):** no non-interactive list command -> manual entry
     ("enter the model ID you already use").
4. **Keep three labels separate — never merge them:**
   - `tool found`: local executable presence (or shim / editor-only / absent)
   - `model offered`: discovered candidate list vs owner-supplied manual entry
   - `launch tested`: `not tested` until an explicitly consented per-run launch
     probe runs and succeeds for that exact `(harness/route, model, reasoning)`

## Step 2 — Explain roles, profiles, and how a saved profile is used

Explain in plain terms before collecting routes:
- A **harness** (tool) runs a **model** with a **reasoning** effort.
- A **role** (or session) is one job in the Bearing Lifecycle. The same tool
  can run separate independent sessions for author work and review (independence
  requires a fresh session with no author ancestry; vendor diversity is an
  owner preference, never a requirement).
- A **profile** is a saved named team configuration in
  `~/.agents/bearing-lite/profiles.json`.
- Edits to `profiles.json` govern **future** task selections and never alter an
  already frozen Lifecycle snapshot.
- **How a saved profile is used** (copyable example):
  `"Use my <ProfileName> profile to plan and implement this task."`
  (Planning and implementation can select the same profile, different profiles,
  or explicit inline routes.)
- Briefly explain each role in scope from its sibling `SKILL.md` (and
  `../bearing-lite/references/consultation.md` for optional catalog-level
  `fellow`), plus note that the **Orchestrator** is the host session you open
  (observed, not a catalog key).

## Step 3 — Collect name, destination, and explicit owner choices

Ask one setting at a time with no preselected value:

1. **Profile name and destination:** ask the exact profile key matching
   `^[A-Za-z][A-Za-z0-9_-]*$` (reject ASCII case collisions with existing keys)
   and confirm the destination `~/.agents/bearing-lite/profiles.json` (and
   create vs edit vs replace if the key already exists).
2. **Development strategy (`development_strategy.mode`):**
   - `single_implementer` (one Implementer writes code and tests) or
   - `tdd` (Test Implementer writes tests first, then Product Implementer writes
     code).
   If `tdd`, collect and confirm **both** `roles.test_implementer` and
   `roles.implementer` independently (even when using the same CLI)—never copy
   one into the other.
3. **Role/session enablement and owner-supplied identities:**
   For each role/session in the chosen scope:
   - If the owner **enables** it: collect the owner's `harness`, `model`,
     `reasoning`, `ordered_fallbacks` (`[]` if none, or ordered entries with
     `condition`, `harness`, `model`, `reasoning`), and `cadence` where
     supported (`reviewer`, `test_engineer.sessions.assurance`,
     `integration_engineer.sessions.execution`: `slice` | `phase` | `lifecycle`;
     `scribe`: `event` | `phase` | `lifecycle`).
   - If the owner **explicitly declines** a role/session: save
     `{ "enabled": false }` (for sessioned roles, `{ "sessions": { "<session>": { "enabled": false } } }`)
     without inventing a `primary` or `ordered_fallbacks`—or if disabling an
     existing complete route, keep its `primary` and `ordered_fallbacks` and
     set `enabled: false`.
   - If a role/session is **deferred / unasked**: omit its key.
4. **Reviewer availability vs task review request:** explain that enabling
   `roles.reviewer` (and setting its `cadence`) makes a fresh Reviewer
   available; whether planning review runs on a specific task is recorded per
   Lifecycle at `journey_settings.planning_wave.review_requested`, not in
   `profiles.json`.
5. **Catalog-level `fellow` (optional, catalog-wide):** ask separately if the
   owner wants an optional top-level `fellow` route (beside `profiles`, never
   under `roles`). Explain from `consultation.md` that only the Orchestrator
   consults it at up to about four checkpoints and keeps the final call. If the
   existing catalog already defines `fellow`, show it read-only and do not
   modify it without an explicit catalog-wide edit confirmation.
6. **Capabilities, clean-session, concurrency, holds, and defaults** (as
   applicable to the chosen scope; see `references/verification-tools.md` and
   `references/catalog-contract.md`):
   - `planning_to_implementation_clean_session` (`true` / `false`)
   - `concurrency` (the two booleans only, never a numeric cap)
   - `review.coverage_assist` (all four `enabled`/`required` states; write both
     `false` when explicitly turned off)
   - `deterministic_verification.reverify.enabled` (save explicit decline as
     `false`) and `additional_tools`
   - `assurance_repair.enabled` and `holds` (in Full setup or when requested)
   - `defaults.planning` / `defaults.implementation` (separate question, never
     a silent grant).

## Step 4 — Editable preview (one row per changed choice)

Before writing any byte, show:
- Target profile name, destination file path (`~/.agents/bearing-lite/profiles.json`),
  and operation (`create`, `edit <name>`, or `replace <name>`).
- One table row **per changed choice**:

| Field / Role | Session | Enabled | Harness / Route | Model | Reasoning | Fallbacks | Cadence | Reason / Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- Separate block for any catalog-wide change (`fellow`, `defaults`) showing
  its catalog-wide scope.
- Explicit list of **deferred** (omitted) and **preserved unchanged** items.
- Ask the owner to **edit**, **save**, or **cancel**.

## Step 5 — Validate before write, save atomically, validate readback

1. Patch **only approved paths** in the parsed existing catalog (preserving
   unaddressed profiles, settings, and declared host-extension keys losslessly).
2. Run the named read-only validator (`scripts/validate-profiles.mjs` with
   `--stdin`, plus `hooks/profiles.cjs` `validateCatalog` /
   `freezeSelectedRoutes` when hooks are present) on the **candidate** JSON
   **before** touching disk.
3. Verify the original file on disk has not changed concurrently (compare raw
   bytes/SHA-256 against Step 0 read). On conflict, cancel, or validation
   failure, leave the original file untouched with no unrequested backup.
4. Write atomically via a sibling temporary file in the same directory and
   `rename`. Store no credentials.
5. Run the named read-only validator (`scripts/validate-profiles.mjs --catalog <path>`,
   plus `evaluateCatalogState` and `freezeSelectedRoutes` /
   `evaluateTddTestImplementerRoute` when hooks are present) on the **readback**
   file and verify preserved extension keys and unaddressed entries survived.
6. Report **three statuses separately**:
   - `catalog_valid`: valid / invalid (with schema and validator path)
   - `strategy_readiness`: ready for chosen `tdd` / `single_implementer` / planning-only
   - `route_test_status`: `not tested` (until Step 6 runs with consent)

## Step 6 — Optional launch probe (opt-in with consent per run)

- Never implied, never run automatically, and never required for a valid save.
- Offer only for harnesses with a supported non-interactive probe (editor-only
  routes report CLI launch testing unavailable).
- Obtain **explicit consent per run** before running any probe, displaying:
  1. exact command, harness/account route, model ID, and reasoning effort
  2. exact call count (at most 1 tiny call per unique `(route, model, reasoning)`)
  3. possible account spend/quota impact
  4. fixed harmless prompt (e.g. reply `OK`), empty scratch workspace, no
     repository tools, bounded timeout, and closed stdin (`< /dev/null` for
     non-streaming commands such as `codex exec`)
- A decline is a successful save with `launch tested: not tested`.
- A passing probe proves reachability at that exact moment only—not reviewer
  independence, tool access, hooks, fallback activation, or handoff readiness.
- Sanitize any error output (never leak tokens, credentials, or raw private
  paths); never auto-substitute or auto-downgrade a failed route.

## Step 7 — Next request to copy

After saving, give the owner:
1. A copyable request for their first task:
   `"For this task, use Bearing with <ProfileName> for planning and implementation."`
2. One targeted-change example:
   `"Change the Reviewer in <ProfileName> in ~/.agents/bearing-lite/profiles.json."`
3. The saved file location (`~/.agents/bearing-lite/profiles.json`) and honest
   status labels (`tool found`, `model offered`, `launch tested`).

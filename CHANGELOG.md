# Changelog

## [Unreleased]

These changes apply to future planning only. Packages frozen before them stay historical and are not migrated; their records and receipts are unchanged.

### Changed

- Changed planning to run as one planning wave (unit `planning`, reviewer `cadence: phase`, `max_assurance_rounds` 1 per wave, the same budget as an implementation wave). The Plan Integrator runs the sessions in input order with no Requirements Engineer gate between them: the register precheck and Requirements Engineer findings go into the one consolidated review, and one aggregated repair and deterministic closure follow. `hooks/planning-review.cjs` will not open the review until every declared planning session has returned for the candidate (`planning_sessions_incomplete`), and still refuses a second review or repair. `hooks/plan-package.cjs draft <plan dir>` checks the package before review. The final freeze, which gates implementation dispatch, also requires a completed `journey_settings.planning_wave` receipt: every session returned, one review, at most one repair, deterministic closure, and the closing candidate digest. Deterministic receipts are reused only while their bound inputs are unchanged. [#205](https://github.com/alphazede/bearing-lite/issues/205)
- Changed the planning correction budget from two `requires_regate` rounds to one, which is the planning wave's one aggregated repair. `hooks/correction-delta.cjs` bounds `correction_rounds` to 0–1 and returns `NEEDS_OWNER_DECISION` for a further `requires_regate` finding. `exact_text` findings still close mechanically in any round. [#204](https://github.com/alphazede/bearing-lite/issues/204)
- Added `journey_settings.review_rounds` to `implementation.json`: one row per declared wave or phase plus `planning`, each with one Reviewer round, at most one repair, and `deterministic_PASS` closure. The freeze rejects a second round, a second repair, a round at no declared boundary, and a unit with no round, each with a typed finding. `hooks/assurance-budget.cjs` reads the same rows for wave and phase units, and the DoD Manifest shows the round plan. [#157](https://github.com/alphazede/bearing-lite/issues/157)
- Made the Planning Integration Engineer responsible for interface, boundary, and data-flow completeness before design is finalized. It records owned sources and sinks, paths, transformations, side effects, state and protocol transitions including illegal ones, trust enforcement, and failure and recovery, and it treats existing formal contracts as authority. The Boundary/Data-Flow Contract lives in the existing artifacts and is copied into `implementation.json` `boundary_contract`, with a justified not-applicable allowed; there is no sixth artifact. Systems Modeler binding and SEIT rows are required, and an unresolved gap blocks the freeze and therefore implementation dispatch. The execution Integration Engineer is unchanged. [#155](https://github.com/alphazede/bearing-lite/issues/155)

## [1.1.9](https://github.com/alphazede/bearing-lite/releases/tag/v1.1.9) - 2026-10-17

### Fixed

- Fixed Lifecycle history going untranscribed because nothing triggered the Scribe. The Scribe route now takes a `cadence` (`event` by default: after each owner decision, authority event, or landing; or `phase` or `lifecycle`). `hooks/scribe-coverage.cjs` lists decisions, authority events, and landings missing from `journey.json` history; resume reports them, handoff refuses, and protected completion blocks until the Scribe runs. An omitted or disabled Scribe is reported as a typed capability gap, never transcribed by the Orchestrator. [#194](https://github.com/alphazede/bearing-lite/issues/194)
- Fixed planning artifacts having no bound author, which let a Coordinator running planning write the plan itself. The planning Orchestrator now dispatches the Plan Integrator once; the Plan Integrator dispatches the planning sessions in a stated order and never authors sections; Planning and Design authors in its own session on the frozen `plan_integrator` route; and the Systems Modeler order is stated once. The write lock refuses the technical plan, `design.md`, `seit.json`, `implementation.json`, and the DoD Manifest from any planning or control role that is not their bound author, the Coordinator included. [#195](https://github.com/alphazede/bearing-lite/issues/195)
- Fixed `python3 test/schema-validation.py` refusing Python 3.14 hosts: the pinned `rpds-py` 0.30.0 now carries its scanned cp314 wheel hash as well as cp312, and the validator accepts Python 3.12 or 3.14. The pin lines are byte-identical to the AlphaZedeHQ copy again. [alphazede/Alphazedehq#278](https://github.com/alphazede/Alphazedehq/issues/278)
- Fixed the planning-review gate rejecting a rendered DoD Manifest named `review.html` with `manifest_not_generated` even when the plan package passed. The gate and the implementation schema now accept `review.html` as well as `<plan-name>-dod-manifest.html`, and still reject paths outside the plan directory, nested paths, missing files, and other HTML files. [#189](https://github.com/alphazede/bearing-lite/issues/189)

### Changed

- Allowed parent-accepted, reproduced late findings to join the same open repair through an immutable addendum, while preserving correction limits, closed-round stops and deterministic closure ([#202](https://github.com/alphazede/bearing-lite/pull/202)).
- Added `node hooks/plan-package.cjs wave <plan dir> <wave id>`, which prints one wave's slices, write sets, resolved commands, and exit commands, with typed findings for an unknown wave, slice, or command. The Coordinator skill now reads its wave with it, launches children with the packet's launch form verbatim, waits for children to exit instead of polling, and runs the wave exit commands after its last commit. [#190](https://github.com/alphazede/bearing-lite/issues/190)

## [1.1.8](https://github.com/alphazede/bearing-lite/releases/tag/v1.1.8) - 2026-10-13

### Fixed

- Fixed Codex registering none of Bearing Lite's hooks when installed from the repository, which left sessions without activation advice or the write-set lock: Codex 0.162.1 silently drops plugin hooks when the root `plugin.json` carries `$schema`. Install Codex from the local marketplace that `tools/prepare-codex-plugin.mjs` prepares, which holds the same package bytes with only that key omitted; the portable `plugin.json` is unchanged. [#188](https://github.com/alphazede/bearing-lite/pull/188)
- Fixed session-start activation reporting `write_lock: absent` even though the shipped `hooks/hooks.json` registers the write-set lock; detection now reads command-form registrations as well as `args`. [#188](https://github.com/alphazede/bearing-lite/pull/188)
- Fixed Codex `apply_patch` edits bypassing the write-set lock and Test Engineering routing, because the patch body arrives in `tool_input.command`, which neither adapter read. Patches to protected planning files are now denied, and patches that add or change test files reach Test Engineering. Shell commands are unaffected. [#188](https://github.com/alphazede/bearing-lite/pull/188)
- Fixed CI and the publish workflow passing with no Codex hooks registered. A required native gate now runs `node --test test/native/codex-hook-discovery.test.mjs` against pinned Codex CLI 0.162.1 and checks that every hook and skill registers. Hook component tests no longer inherit a parent session's `BEARING_ROLE`. [#188](https://github.com/alphazede/bearing-lite/pull/188)

## [1.1.7](https://github.com/alphazede/bearing-lite/releases/tag/v1.1.7) - 2026-10-13

### Changed

- Added draft requirement-register prechecks before specialist dispatch, catching mechanical errors without spending semantic correction rounds. [#178](https://github.com/alphazede/bearing-lite/pull/178)
- Constrained planning corrections to named changes and required exact-text closure evidence. [#180](https://github.com/alphazede/bearing-lite/pull/180)
- Standardized packaged skills on a 650-word limit while retaining the existing line limit. [#179](https://github.com/alphazede/bearing-lite/pull/179)
- Updated pinned CI and publishing actions. [#181](https://github.com/alphazede/bearing-lite/pull/181)
- Required shared-machine test isolation, five consecutive engine-starting runs, concurrent qualification, and explicit resource and gate-time declarations; kept schema metadata optional for existing plans. [#184](https://github.com/alphazede/bearing-lite/pull/184)
- Aligned all seven package and host manifests to 1.1.7 and reconciled the accumulated release record ([#187](https://github.com/alphazede/bearing-lite/pull/187)).

### Fixed

- Rejected incomplete or malformed planning manifests that previously passed the planning-freeze projection gate. [#177](https://github.com/alphazede/bearing-lite/pull/177)
- Required prompts to map acceptance criteria to observable evidence and name trust boundaries with negative checks. [#183](https://github.com/alphazede/bearing-lite/pull/183)
- Fix `tools/render-dod-manifest.mjs` exiting 0 without output when invoked through a symlinked install path; symlinked directory and file invocations now behave identically to the real path ([#185](https://github.com/alphazede/bearing-lite/pull/185)).

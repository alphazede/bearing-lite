# Changelog

## [Unreleased]

### Fixed

- Removed the last hard-coded correction cap: the recovery contract-test model no longer forces `OWNER_DECISION_REQUIRED` on a third correction or rejects a fourth; a correction with new evidence returns `READY`. Skill-text caps were already removed in 2.0.0 ([PR #212](https://github.com/alphazede/bearing-lite/pull/212), refs [#211](https://github.com/alphazede/bearing-lite/issues/211)).

## [2.0.1](https://github.com/alphazede/bearing-lite/releases/tag/v2.0.1) - 2026-10-18

### Changed

- Prepared the 2.0.1 package and plugin release ([PR #220](https://github.com/alphazede/bearing-lite/pull/220)).

### Fixed

- Make Scribe optional: Orchestrator records history when it is off, while an enabled Scribe keeps one persistent lifecycle session; handoff and completion still require complete source-backed history ([PR #219](https://github.com/alphazede/bearing-lite/pull/219)).

- Preserve frozen decision holds and clarify Coordinator escalation after two evidence-based routine-resolution attempts, with optional scoped Orchestrator delegation disabled by default ([PR #218](https://github.com/alphazede/bearing-lite/pull/218)).

## [2.0.0](https://github.com/alphazede/bearing-lite/releases/tag/v2.0.0) - 2026-10-18

### Changed

- Combined Architectural Alignment and Scope in the controller session; moved final plan/design, assembly and handoff to the Orchestrator. Removed the Plan Integrator skill and retired `plan_integrator` / `planning_and_design` profile routes. Existing configurations must remove those roles and use the Orchestrator ([PR #217](https://github.com/alphazede/bearing-lite/pull/217)).
- Made specialist roles profile-configured and independent review owner-requested. Requirements authors check their own work before test planning; prompts preserve role loops and one assignment per agent. Coordination waits for response events, and arbitrary three-attempt limits are removed ([PR #217](https://github.com/alphazede/bearing-lite/pull/217)).
- Added concise onboarding, role explanations, explicit resume/handoff guidance, and optional OpenCodeReview, Reverify and additional verification tools with frozen capability preservation ([PR #217](https://github.com/alphazede/bearing-lite/pull/217)).

### Fixed

- Required explicit owner-requested current native session/task binding before general hooks advise, enforce ownership or synchronize Git. Ordinary, stale and cross-session work stays quiet and never fetches or fast-forwards. Existing plans opt in through the visible `bearing_session` field; standalone selected Test Engineering and explicit assurance bindings retain their own boundaries ([PR #217](https://github.com/alphazede/bearing-lite/pull/217)).
- Rejected unresolved final requirement/test-case bindings and verified the actual unchanged-input snapshot when adopting planning evidence ([PR #217](https://github.com/alphazede/bearing-lite/pull/217)).
- Included the previously prepared assurance-budget fix: atomic reservations, fixed parallel groups, exact owner amendments and deterministic repair closure, preserving ordinary unbound work and explicit native versus component qualification ([PR #215](https://github.com/alphazede/bearing-lite/pull/215), preparation [PR #216](https://github.com/alphazede/bearing-lite/pull/216)).

## 1.1.12 - 2026-10-17

Prepared but not tagged or published. Its changes are included in 2.0.0.

### Fixed

- Enforced bound assurance budgets before dispatch with atomic reservations, fixed parallel groups, exact owner amendments and deterministic repair closure. Preserved ordinary unbound work and explicit native versus component qualification ([#209](https://github.com/alphazede/bearing-lite/issues/209), duplicate [#210](https://github.com/alphazede/bearing-lite/issues/210); [PR #215](https://github.com/alphazede/bearing-lite/pull/215); release [PR #216](https://github.com/alphazede/bearing-lite/pull/216)).

## [1.1.11](https://github.com/alphazede/bearing-lite/releases/tag/v1.1.11) - 2026-10-17

### Changed

- Ended native-client support for Qwen Code, Kimi Code, and Grok Build. Retained metadata is legacy-only and excluded from release qualification ([PR #207](https://github.com/alphazede/bearing-lite/pull/207)).
- Assigned early interface, data-flow, protocol, trust-boundary and recovery analysis to the Planning Integration Engineer, with resolving SEIT proof cases in existing artifacts. [#155](https://github.com/alphazede/bearing-lite/issues/155) ([PR #207](https://github.com/alphazede/bearing-lite/pull/207)).

### Fixed

- Fixed parent-accepted Reviewer repairs being refused by the planning write lock. A recorded transition now binds the frozen receipt, reviewer context, candidate lineage and repair paths; non-parent record writes, unlisted planning paths and role-label bypasses are refused. [#206](https://github.com/alphazede/bearing-lite/issues/206) ([PR #208](https://github.com/alphazede/bearing-lite/pull/208)).

- Removed blocking Requirements Engineer gates from future planning: all planning sessions feed one consolidated review, one repair and deterministic closure, with valid unchanged-input evidence reused. [#205](https://github.com/alphazede/bearing-lite/issues/205) ([PR #207](https://github.com/alphazede/bearing-lite/pull/207)).
- Limited planning to one evidence-changing correction round while preserving mechanical exact-text closure. [#204](https://github.com/alphazede/bearing-lite/issues/204) ([PR #207](https://github.com/alphazede/bearing-lite/pull/207)).
- Enforced a single review-round declaration per planning, wave or phase unit in the package freeze, runtime budget and DoD Manifest. Final freeze requires resolving review evidence and preserves the reviewed-to-repaired candidate lineage. [#157](https://github.com/alphazede/bearing-lite/issues/157) ([PR #207](https://github.com/alphazede/bearing-lite/pull/207)).

## [1.1.10](https://github.com/alphazede/bearing-lite/releases/tag/v1.1.10) - 2026-10-17

Tagged but not published to npm. Its changes are included in 1.1.11; the tag remains unchanged ([PR #208](https://github.com/alphazede/bearing-lite/pull/208)).

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

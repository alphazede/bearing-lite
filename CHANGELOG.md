# Changelog

## [Unreleased]

## [3.0.0-rc.2] - 2026-11-18

### Added

- Add reusable planning security control catalogue (`catalog/controls/` and `schemas/control-catalogue.schema.json`) with LUKS, one-way nftables, AppArmor, and vTPM seed entries, selection/parameterization guidance in `skills/mbse/` and `skills/integration-test/`, and `plan-package.cjs` selection validation. (Alphazedehq#584)

### Fixed

- `sanitizeSvg` in `tools/render-dod-manifest.mjs` skips XML comments after whitespace or text between SVG elements while keeping all other sanitizer refusals unchanged. (Alphazedehq#575)
- `plan-package` `checkWorkClass` inspects slices (`slices` and `waves[].slices`) only, so `dod_manifest.tasks` rows with `work_class: light` are not flagged as light slices. (Alphazedehq#576)
- `plan-package` checks `requires`, `step`, `step_id`, and `integration_steps` only on slices instead of every object in `implementation.json`. (Alphazedehq#577)
- Fix `onboard-bearing` checklist coverage (catalog `fellow`, merged `mbse`/`integration_test` roles, `defaults`, `assurance_repair`, no keyless questions), name `hooks/profiles.cjs` validation while preserving host-extension keys, clarify `welcome.md` lineup wording, and align `profiles.md` Route effort and Fellow with opened Orchestrator sessions. (Alphazedehq#582)
- Repair onboarding findings R01-R22 across `skills/onboard-bearing`, `hooks/profiles.cjs`, `schemas/profiles.schema.json`, `tools/compile-handoff.mjs`, and `README.md`, add standalone read-only `validate-profiles.mjs` with bundled `profiles.schema.json`, support explicit route declines and lossless extension keys, enforce both TDD author routes and separate `lifecycle_settings` freeze metadata, and add the guided first-profile walkthrough with zero model guidance. (Alphazedehq#586)
### Changed

- Prohibit planning correction loops: specialists fold known corrections into their first return, the Planning Orchestrator applies remaining author-known fixes during assembly without relaunching specialists, and `correction-delta` `exact_text_mismatch` errors name `requires_regate` for non-text field changes. (Alphazedehq#578)
### Changed

- Move the optional Fellow route from per-profile `roles` to the top-level catalog `fellow` envelope so every frozen binding carries `snapshot.fellow` regardless of selected profile. (Alphazedehq#579)
- Merge planning specialist roles into MBSE (`roles.mbse.sessions.planning`) and Integration and Test (`roles.integration_test.sessions.planning`), remove `requirements_engineer`, `systems_modeler`, and the planning sessions of `test_engineer` and `integration_engineer`, keep `test_engineer.sessions.assurance` and `integration_engineer.sessions.execution`, and document `plan-package.cjs` slice rules in both new planning skills. (Alphazedehq#580)
- Freeze requirement skeletons (UIDs and titles) and active decisions at specialist dispatch so `mbse` and `integration_test` start in parallel, apply a zero author-known relaunch budget with Orchestrator mechanical ID/hash edit records (returning meaning changes to the author), let delta packets fix defects found in the delta, require an owner question box for scope cuts dropping acceptance items even under delegation, and split plans one per phase. (Alphazedehq#581)
- Apply #544 planning speed rules: run the repository gate once at assembly while specialists run only their own artifact checker, return evidence as digests, commands, and exit codes instead of narrative logs, select `light` (orchestrator plus one author), `standard`, or `full` process tiers by a stated risk rule, carry a time target with limit-return gap listing in every packet, and reuse the previous `repository-map.md` after an Alignment freshness check. (Alphazedehq#583)

## [3.0.0-rc.1] - 2026-11-18

### Added

- Bearing 3.0 batch 4: Coordinator role retired (its duties now live in the Implementation Orchestrator text; pinned legacy journeys keep their owner); public role-level replay report; decision adapter sends keyed systemone requests and reads ChoiceAnswer responses. ([#256](https://github.com/alphazede/bearing-lite/pull/256))
- Bearing 3.0 batch 3: advisory decision adapter with pinned hosted backend and consultation return, called from the registered SessionStart and Stop handlers; approved #237 public skill updates (coordinate-only Orchestrator, dependency-ordered dispatch, rolling batch review, owner-record conflicts follow the later approved artifact, skill size cap removed). ([#255](https://github.com/alphazede/bearing-lite/pull/255))
- Bearing 3.0 batch 2: profiler host qualification from controlled-session totals and role-only export; optional Fellow profile route; dispatch recovery record and ready-set evaluator; deterministic handoff compiler and closed handoff schema; Coordinator duty migration to receiving components; replay-based promotion rule; wave 1 baseline rerun on observed runs. ([#254](https://github.com/alphazede/bearing-lite/pull/254))
- Planning and Assurance Test Engineer guidance for a selected behavior-not-implementation test-suite audit, including the loss-proof reduction record.
- Bearing 3.0 wave 1: opt-in journey profiler (`tools/journey-profiler.mjs`, `schemas/journey-profile.schema.json`) with atomic output and public-code export; restyled DoD Manifest review sheet with Bearing artwork; Systems Modeler findings and DoD Manifest model entries; prompt audit, decision taxonomy, host-limit matrix, Pstack capability matrix and acknowledgements, and the wave 1 baseline under `docs/architecture/`. ([#253](https://github.com/alphazede/bearing-lite/pull/253))
- Opt-in native real-harness acceptance suite (`test/native/harness-acceptance.test.mjs`) and a versioned compatibility matrix (`docs/harness-compatibility.md`) that separates install, discovery, advisory and blocking evidence and labels unverified capabilities explicitly. ([PR #245](https://github.com/alphazede/bearing-lite/pull/245), closes [#92](https://github.com/alphazede/bearing-lite/issues/92))
- An explicitly named `orchestrator` skill that forwards to the canonical Bearing Orchestrator (`bearing-lite`), with matching explicit-invocation metadata and native discovery evidence for Codex and Claude Code. ([PR #246](https://github.com/alphazede/bearing-lite/pull/246), closes [#214](https://github.com/alphazede/bearing-lite/issues/214))
- `tools/lifecycle-pool.mjs`: a bounded worktree pool with exclusive leases, safe reclamation of merged worktrees (no `--force`), owner-registered test-artifact cleanup that preserves shared caches, dry-run, recovery, thresholds and reclaimed-bytes accounting, wired into Coordinator and storage-lifecycle guidance. ([PR #247](https://github.com/alphazede/bearing-lite/pull/247), closes [#233](https://github.com/alphazede/bearing-lite/issues/233))
- SEIT proof cases can record an optional `oracle_source` (derivation from production logic is rejected) and a `property_based` applicability decision. The Test Engineer evaluates property-based testing per claim, and assurance treats circular oracles and unrun property claims as gaps. ([PR #248](https://github.com/alphazede/bearing-lite/pull/248), closes [#154](https://github.com/alphazede/bearing-lite/issues/154))
- When the frozen profile sets `assurance_repair.enabled`, the Assurance Test Engineer may make one bounded same-session repair of a proven test-side defect, reusing the Reviewer's repair transition. Deterministic verification decides afterwards; without the field, behavior is unchanged. ([PR #249](https://github.com/alphazede/bearing-lite/pull/249), closes [#243](https://github.com/alphazede/bearing-lite/issues/243))

### Changed

- CI: bump `actions/setup-node` and `actions/setup-python` to v7.1.0 and `github/codeql-action` to v4.39.1, all pinned by verified commit SHA. ([PR #230](https://github.com/alphazede/bearing-lite/pull/230))
- Prompt packets let agents resolve routine prerequisite and adjacent-file work within the approved outcome, while preserving supplied owner, role, repository and contribution authority. Dependency or lockfile changes still need existing permission. ([PR #251](https://github.com/alphazede/bearing-lite/pull/251), replaces [#231](https://github.com/alphazede/bearing-lite/pull/231))

### Fixed

- Planning findings and owner-added scope are consumed before assembly; only end-of-planning review findings use the repair round.
- `test/task-opt-in.test.mjs` no longer changes result when the caller environment carries `BEARING_ROLE`.
- The assurance-dispatch hook no longer denies every Bash call when the session working directory is missing or unreadable and no task binding resolved. Bound assurance stays fail-closed. ([PR #238](https://github.com/alphazede/bearing-lite/pull/238), fixes [#229](https://github.com/alphazede/bearing-lite/issues/229))
- `register-precheck` accepts any uppercase-prefix case ID (for example `VCASE-`) in explicit verification-case fields and resolves it against SEIT. Free-text `VERIFICATION` prose keeps the original narrow recognition. ([PR #241](https://github.com/alphazede/bearing-lite/pull/241), fixes [#227](https://github.com/alphazede/bearing-lite/issues/227))
- The final freeze can record a post-approval planning correction in an append-only `journey_settings.planning_corrections` list, with its own review, repair and closing candidate, without rewriting round-1 provenance. ([PR #242](https://github.com/alphazede/bearing-lite/pull/242), fixes [#226](https://github.com/alphazede/bearing-lite/issues/226))
- Shipped hooks are audited (keep or quiet-unless-gated, with reasons) in `docs/architecture/hook-audit.md`. Advisory closeout and git-sync stay silent on a second stop, including Cursor `loop_count` re-entry, and stop advice never auto-continues. ([PR #244](https://github.com/alphazede/bearing-lite/pull/244), closes [#139](https://github.com/alphazede/bearing-lite/issues/139))
- The native harness suite derives the packaged skill count from `skills/` instead of hard-coding 16, and checks that the compatibility matrix states the same count. ([PR #250](https://github.com/alphazede/bearing-lite/pull/250))

## [2.0.3](https://github.com/alphazede/bearing-lite/releases/tag/v2.0.3) - 2026-10-28

### Added

- Consolidated portable workflow behaviors into the public skills: independently justified test oracles with circular-expectation rejection and coverage reuse (`test-engineer`, `implementer`), a reusable real-app verification procedure, an optional formal-analysis path, a Requirements Engineer author self-correction loop, method-skill routing with durable task graphs and storage lifecycle (`coordinator`, `bearing-lite`), an OOPDSA Implementation Design lens for plans and slices, and program planning with milestone ladder, dependency domains, bottom-up estimates, notices, and tiered replanning. ([PR #228](https://github.com/alphazede/bearing-lite/pull/228))

### Changed

- Let Reviewer start bounded OCR bug/security coverage while assessing architecture and verification evidence, then repair validated in-scope findings under advance authority in the same session. Preserve candidate, write-set and review/repair limits. ([PR #228](https://github.com/alphazede/bearing-lite/pull/228))

### Fixed

- Dispatch owner-requested review and assurance as soon as each frozen boundary passes its deterministic checks, without a second request or deferral to a later wave. With waves declared, `phase` cadence already reviews at every wave end ([#222](https://github.com/alphazede/bearing-lite/issues/222)). ([PR #228](https://github.com/alphazede/bearing-lite/pull/228))
- Land each closed unit: commit on the leased Lifecycle branch, run exit commands after that last commit, push, and open or update one PR to the default branch. Merge only when the frozen authority envelope allows `merge` for that unit; otherwise merge stays with the owner ([#223](https://github.com/alphazede/bearing-lite/issues/223)). ([PR #228](https://github.com/alphazede/bearing-lite/pull/228))
- Return author-known exact-text deltas on another role's artifact to their owner at the next in-wave reconciliation, with one binding refresh and no review, repair or round spent ([#221](https://github.com/alphazede/bearing-lite/issues/221)). ([PR #228](https://github.com/alphazede/bearing-lite/pull/228))

## [2.0.2](https://github.com/alphazede/bearing-lite/releases/tag/v2.0.2) - 2026-10-21

### Fixed

- Removed the last hard-coded correction cap: the recovery contract-test model no longer forces `OWNER_DECISION_REQUIRED` on a third correction or rejects a fourth; a correction with new evidence returns `READY`. Skill-text caps were already removed in 2.0.0 ([PR #224](https://github.com/alphazede/bearing-lite/pull/224), refs [#211](https://github.com/alphazede/bearing-lite/issues/211)).

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

# Changelog

## [Unreleased]

- Fixed Codex registering no Bearing Lite hooks when installed from the npm package: Codex (0.162.1 through at least 0.172.0) reads a root `plugin.json` that carries the Agent Plugins `$schema` instead of `.codex-plugin/plugin.json` and then loads no plugin hooks, and the package omitted `.codex-plugin/`, so `tools/prepare-codex-plugin.mjs` could not run from it. The npm package now ships `.codex-plugin/`; run `node package/tools/prepare-codex-plugin.mjs --out <new dir>` from the extracted package and install that marketplace. `test/native/codex-hook-discovery.test.mjs` now prepares from `npm pack` output. ([Alphazedehq#787](https://github.com/alphazede/Alphazedehq/issues/787))
- Keep `docs/harness-compatibility.md` aligned with the current 16-skill distributable while preserving the dated 2026-11-17 2.0.3 observation, and probe `copilot` offline plugin install and skill discovery in `test/native/harness-acceptance.test.mjs` when Copilot CLI is present while still reporting `UNAVAILABLE` when absent.
- Compile every slice of a plan that passes final freeze in `tools/compile-handoff.mjs`. A slice with an empty `seit_proof_rows` list takes its goal as acceptance and its `stop_condition` as evidence. A slice with an empty `command_ids` list takes, for each of its SEIT proof rows, the command `seit.json` ties to that row (`proof_cases[].command_id`) when a Test Implementer slice sharing the row lists it, else no command; a light slice without a command and a malformed paired command list stay `commands` gaps. The compiled route now applies `scoped_owner_amendment` before the snapshot, as the route guard does, including its own `enabled` flag and an empty `ordered_fallbacks`, and a binding without a snapshot `roles` object is a `binding` gap. `schemas/handoff.schema.json` allows an empty `commands` list. (Alphazedehq#779)
- Add the advisory `node hooks/plan-package.cjs commands <plan dir>` planning check, which runs each SEIT command's declared `<executable> --help` dry-run form (never the command) and names a missing required or unknown option (`seit_command_args_rejected`) or an unresolved executable (`seit_command_unresolved`) before final freeze. The help form must be side-effect free on the planning host; it runs in its own process group, which is killed afterwards. Options after the first script, subcommand or positional word are not checked. ([Alphazedehq#781](https://github.com/alphazede/Alphazedehq/issues/781), [PR #290](https://github.com/alphazede/bearing-lite/pull/290))

## [3.1.3](https://github.com/alphazede/bearing-lite/releases/tag/v3.1.3) - 2026-11-26

- Require the Planning Orchestrator to open the rendered DoD Manifest HTML in the owner's browser (Chrome when available) and deliver the file before asking for integrated owner confirmation, record `manifest_delivery` (`path`, `sha256`, `opened_in`, `delivered_at`) on the owner confirmation record in `journey.json` and `skills/bearing-lite/templates/handoff.md`, and refuse `mode: "handoff"` in `hooks/closeout.cjs` with `handoff_refused:manifest_not_delivered` when delivery is missing or mismatched. ([#285](https://github.com/alphazede/bearing-lite/issues/285), [PR #286](https://github.com/alphazede/bearing-lite/pull/286))
  Previously valid handoffs without this delivery record now return to planning; do not fabricate historical delivery evidence.
- Arm the Code Mode scope observer before routine readiness so pre-ready memory-limit kills report `resource_limit` (`memory`), and probe host sandbox prerequisites independently of the runtime in tests.
- Wait up to 20 minutes (polling every 20 seconds) in `.github/workflows/bearing-publish.yml` while required hosted checks are `queued` or `in_progress`, failing immediately on any completed non-success or missing check.

## [3.1.2](https://github.com/alphazede/bearing-lite/releases/tag/v3.1.2) - 2026-11-26

- Split `.github/workflows/bearing-publish.yml` into an unapproved `verify` job that runs all release checks and packs a SHA-256-verified tarball artifact, followed by the `npm-publish`-gated `publish` job that confirms the tag commit and tarball hash before publishing that exact file with npm trusted publishing.
- Place the Code Mode sandbox scope in `background.slice` with `OOMPolicy=continue` so routine memory-limit kills stay enforced without triggering desktop `oom-kill` notifications.

## [3.1.1](https://github.com/alphazede/bearing-lite/releases/tag/v3.1.1) - 2026-11-26

Version 3.1.0 was tagged but never published: its release check failed on one test. 3.1.1 carries the same changes with that test corrected.

- Add the opt-in Code Mode pilot. The broker handles typed capability calls. A resource-limited sandbox runs generated programs and reviewed routines. With the pilot off, only capabilities on the direct allowlist can run. See `docs/guides/code-mode.md` and `schemas/code-mode.schema.json`. ([#279](https://github.com/alphazede/bearing-lite/pull/279))
- Add the opt-in visual Definition of Done Manifest view (`tools/render-dod-manifest.mjs --visual`), written as a separate HTML file; the default Manifest output is unchanged.
- Add the opt-in Plannotator owner review adapter (`tools/plannotator-adapter.mjs`, `tools/plannotator-relay.mjs`), which records owner feedback outside the frozen plan package (`schemas/owner-feedback.schema.json`) and hands the answer to the existing owner-decision procedure without granting authority. Guide: `docs/guides/plannotator-review.md`.
- Add the opt-in review change outline (`skills/reviewer/references/optional-techniques.md`) and measured repair loop (`skills/bearing-lite/references/wave-operations.md`), used only when the owner or packet asks for them.
- Document how to turn off, roll back and remove each optional pilot, including the safe Code Mode cutover and the supported package and launcher combinations. The npm package does not include `docs/guides/`; read [`docs/guides/optional-pilots.md`](https://github.com/alphazede/bearing-lite/blob/main/docs/guides/optional-pilots.md) and [`docs/guides/code-mode.md`](https://github.com/alphazede/bearing-lite/blob/main/docs/guides/code-mode.md) in the repository. ([#279](https://github.com/alphazede/bearing-lite/pull/279))
- Test that each optional pilot can be disabled, left without its dependency or removed while ordinary commands keep their pre-pilot output (`test/pilot-removal.test.mjs`), and add Code Mode outcome and owner feedback rows to `test/schema-validation.py`.
- Redact real user-home prefixes (`/home/<user>/` and URL-encoded equivalent) from historical plan and evidence files under `docs/plans/`, with redaction notes beside affected digest records.
- Add optional `reviewer_repair` (`{ enabled: boolean }`) to the profile schema, catalog validators, and frozen snapshots to expose same-session Reviewer repair preauthorization as a typed field, advise in `hooks/assurance-dispatch.cjs` only when `reviewer_repair.enabled` is true and a Reviewer packet forbids repair, and document the plain-packet Reviewer repair rule across the Prompt, role-loops, Orchestrator, and Reviewer skills, task template, assurance policy, and `repair-transition.md` (scoping `repair_transition` to Assurance Test Engineer `assurance_repair`, protected planning artifacts, and legacy rounds; plus update `skills/bearing-lite/references/live-wave.md` pane-splitting behavior). ([#275](https://github.com/alphazede/bearing-lite/issues/275))

## [3.0.1](https://github.com/alphazede/bearing-lite/releases/tag/v3.0.1) - 2026-11-23

- Add `tools/render-mermaid-view.mjs`, a deterministic local helper that renders a Mermaid view with `mmdc` (`htmlLabels: false`) into a manifest-safe SVG by inlining computed presentation attributes and applying the DoD Manifest SVG allowlist, and document it in the MBSE skill for diagram-assisted views. The SVG sanitizer now names the actual offending element, attribute, or at-rule in its refusals and scopes root-id stylesheet selectors onto the root scope class so colours are no longer silently dropped, while still refusing scripts, `foreignObject`, event handlers, external URLs, and unsafe CSS. ([#271](https://github.com/alphazede/bearing-lite/issues/271))
- Add an optional profile default execution mode (`execution.live_wave`: `herdr` or `headless`) frozen into the snapshot and configuration digest, copied by Planning and Design into `journey_settings.live_wave`, with a recorded owner amendment for plan overrides and the launcher reporting a `live_wave_unavailable` typed gap instead of silent headless dispatch; live-wave guidance now states a cooperating launcher opens slice-labelled panes in the wave's own tab without changing focus. ([#270](https://github.com/alphazede/bearing-lite/issues/270), [#272](https://github.com/alphazede/bearing-lite/issues/272))

## [3.0.0](https://github.com/alphazede/bearing-lite/releases/tag/v3.0.0) - 2026-11-20

- Pin `az-lint` to `v0.1.2`, which stops pull-request lint from reporting `EXE001` on executable scripts. ([#268](https://github.com/alphazede/bearing-lite/pull/268))
- Harden the hosted lint step: hash-pinned Python tools, pull requests linted in untrusted mode with the base revision's configuration, and `az-lint` pinned to `v0.1.1`. ([#267](https://github.com/alphazede/bearing-lite/pull/267))
- Pin `az-lint` to its re-authored `v0.1.0` commit; the files are unchanged. ([#266](https://github.com/alphazede/bearing-lite/pull/266))
- Keep refused messages advisory when a body or reply target is unavailable. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Exclude fenced examples when resolving register decision traces. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Use the digest-bound workspace decision record in final register validation. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Keep unreadable planning-wave closure evidence advisory during draft freeze. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Summarize refused live-wave messages without counting them as delivery failures. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Allow a zero-round budget for waves without wave-level review. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Use digest-bound Alignment decisions for final register validation. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Report final planning-wave closure gaps as advisory findings during draft freeze. ([#265](https://github.com/alphazede/bearing-lite/pull/265))
- Lint changed files with [`az-lint`](https://github.com/alphazede/az-lint) as a blocking step before tests, locally and in the hosted gate. ([#264](https://github.com/alphazede/bearing-lite/pull/264))

## [3.0.0-rc.7] - 2026-11-19

- Add opt-in Herdr live-wave evidence to plan freeze, wave views, and closeout handoffs, with a shared role reference.
- Verify Mermaid views in plan freeze without requiring synchronous ESM loading, including in hooks-only installs.
- Link the shared live-wave instructions from the canonical Orchestrator, MBSE, and Integration and Test skills.
- Preserve advisory live-wave evidence when closeout uses the final freeze receipt.
- Resolve the late technical plan within the checkout and reuse the verified bytes for register precheck.
- Ship the JSON Schema for each live-wave exchange record.
- Display missing, stale, and invalid model views as gaps in the manifest diagnostic.

- Accept digest-bound Mermaid source views in the plan schema and final freeze.

- Render digest-bound Mermaid source files as text views for diagram-assisted models.

- Specify a single string for MBSE model trace IDs so the authored manifest matches the implementation schema.

- Bind the final technical plan in the implementation package when it is written after the SEIT return.

- Include the compact closeout receipt fields in the planning handoff template.

- Resolve register citations from the same repository root during requirements precheck and final freeze.

## [3.0.0-rc.6] - 2026-11-19

- Translate Antigravity session, workspace, and continuation fields in its own adapter so shared hook consumers keep their existing input behavior. (Alphazedehq#636)

- Apply AGY tool exemptions to AGY assurance dispatch only. Other hosts retain their declared dispatch rules. (Alphazedehq#636)

- Give the same recovery instructions for a never-launched Scribe in standalone coverage, resume, handoff, and closeout. (Alphazedehq#642)

- Include the empty required specialist schedule in contained-tool planning results alongside the existing freeze and review requirements. (Alphazedehq#643)

- Retain the prior planning tier when supplied scope, repository, owner tier, or full-tier risk flags leave containment unconfirmed. (Alphazedehq#643)

- Document Antigravity installation from a staged npm payload with the AGY manifest and all seven hook registrations. (Alphazedehq#636)

- Preserve single replacements, batch edits, and replace-all options when forwarding AGY tool calls to Bearing hooks. (Alphazedehq#636)

- Check all reported AGY file targets with the write lock and prefer the path field for the requested tool. (Alphazedehq#636)

- Add the lighter `light` planning tier for a contained tool change (`tool_change`, one repository, no new trust boundary, no live host) in `skills/planning-and-design/SKILL.md`, `skills/bearing-lite/references/planning-assembly.md`, `skills/bearing-lite/references/verification.md`, `hooks/verification.cjs` (`resolveProcessTier`, re-exported by `hooks/verification-bridge.cjs`), and `schemas/verification.schema.json`, returning fewer planning sessions (`planning_sessions: 0`, `required_sessions: []`), the same freeze (`same_freeze: true`), and one review (`reviews: 1`) only when every criterion holds and keeping the prior tier on any unmet or unknown criterion. (Alphazedehq#643)

- Launch an enabled Scribe once at the start of the Lifecycle on its frozen cadence (`roles.scribe.cadence`, `event` default), and name a never-launched enabled Scribe as the gap the Orchestrator acts on in `hooks/closeout.cjs`, `skills/bearing-lite/references/planning-assembly.md`, and `skills/bearing-lite/references/resume.md` without adding a new refusal. (Alphazedehq#642)

- Add root `hooks.json` and `hooks/com.google.antigravity/host.cjs` AGY adapter so all 7 Bearing hooks with AGY events (`SessionStart`, `PreToolUse`, `Stop`) run natively under AGY, and update `docs/harness-compatibility.md` and `hooks/com.anthropic.claude-code/mapping.md` from live AGY 1.5.12 verification. (Alphazedehq#636)

- Define `test_engineer.assurance` and `integration_engineer.execution` in `assurance-policy.md` as cadence keys distinct from `profiles.json` schema paths (`roles.<role>.sessions.<session>`), and use schema session paths consistently in `profiles.md` and onboarding docs. (Alphazedehq#639)

- Skip the enable question and go straight to the route question for required profile roles (`roles.implementer`, and `roles.test_implementer` under `tdd`) in onboarding, keeping the enable question for optional roles. (Alphazedehq#638)

## [3.0.0-rc.5] - 2026-11-19

- Test Codex hook trust in an isolated install. Current saved trust runs SessionStart and all three Stop hooks. Stale plugin content trust reports modified trust and fails the hooks. (Alphazedehq#634)
- Order planning returns as Orchestrator inputs, `integration_test`, verify-only `mbse`, then regenerate `implementation.json`. If a verify-only return reads `implementation.json`, regenerate it first and bind the return to that candidate. (Alphazedehq#627)
- Use focused checks before review. Run the landing repository gate once on the final head after review and any repair, then merge that exact head. (Alphazedehq#618)
- Require a frozen SEIT command to meet its declared pass outcome on expected input and exit non-zero because of the seeded defect on bad input. Record why an authorized run cannot proceed. (Alphazedehq#633)
- Preserve adopted specialist returns across recorded mechanical bindings only when candidate bytes prove the named SEIT hash or SDoc case edit. Retain those bytes when a later repair or correction changes the file. (Alphazedehq#624)
- Record `CANDIDATE_READY` without spending a closing return. Keep each external item open through later author returns until there is closure for its item ID and declared owner. (Alphazedehq#626)
- Validate planning input rows with `path`, a 64-hex file `sha256`, and optional `git_blob`. SEIT rows retain existing provenance fields. A `git_blob`-only input reports `sha256_required`. (Alphazedehq#625)
- Ignore blank, undeclared JSON during plan freeze, preserve live hash checks in existing JSON sidecars, and name unreadable artifacts. (Alphazedehq#628)

## [3.0.0-rc.4] - 2026-11-19

- Clarify that the copy/read exception applies only when live hosting is the sole reason for the full assurance tier.
- Update the draft PR to the verified final commit before marking it ready. When review and landing share a repository gate, use the same exact-head result.
- Bind early assurance to the final integrated candidate. Reuse applicable slice evidence, join the final receipts, and independently validate the single gate run in the same session.
- Use target-host handoff details when scheduling host work and keep the intake return to planning scoped to final-freeze receipt checks.
- Keep the prior live-host tier when any planned operation is unspecified, including an empty slot in the operation list.
- Gate once per landing in `skills/bearing-lite/references/task-state.md#landing-a-closed-unit` and closeout descriptions (finish change and focused checks, push and open draft PR for its number, commit `CHANGELOG` link, gate once on that head with unchanged-head push-gate reuse, mark ready and merge that same head; head change after gating is a procedure defect, exact-head merge receipt unchanged). (Alphazedehq#618)
- Require packets to name the verified Git object for tracked inputs and keep the exact author draft through assurance, and require the Orchestrator to start in a directory that survives cleanup and name the worktree explicitly for short commands. (Alphazedehq#617)
- Require review packets and implementation outputs before a first live apply to supply the frozen host and class rows and the exact proposed operand list, not only the executor diff. (Alphazedehq#616)
- Allow independent assurance to start on finished slices' immutable receipts and the pinned candidate while the last slice runs and join the last slice's receipts before issuing its verdict while keeping single-run role and gate budgets. (Alphazedehq#615)
- Require the plan and `skills/bearing-lite/templates/handoff.md` to state how the exact candidate and its proof travel to a target host, who may approve that transport, and what may land locally when the host gate cannot run. (Alphazedehq#614)
- Decide the `standard` live-host tier per planned operation (`operations` entries must all be `copy` or `read`) rather than by a whole-phase `copy_only` or `read_only` label, returning the prior tier for any phase with another operation. (Alphazedehq#611)
- Require a nonblank rationale for a declared tooling choice and a nonblank reuse statement for new tooling. Existing plans may omit the choice. (#609)
- Keep serial-chain warnings advisory and avoid flagging shared input paths or edges with incomplete legacy flow declarations. (#608)
- Show frozen slice inputs and held resources in the DoD Manifest task graph, including inline wave slices. (#608)
- Validate inputs and held resources for inline wave slices as well as top-level slices. Legacy slice references remain valid. (#608)
- Hold declared external inputs until their required versions are observed, and allow an observed input before a later writer runs. (#608)
- Schedule from the full frozen slice graph so independent waves can proceed while cross-wave inputs, dependencies, and resource holds are respected. Preserve the freeze command for a plan directory named `ready`. (#608)
- Keep live-service observation policy in tier resolution records and preserve the existing verification receipt schema. (#611)
- Apply the live-host tier exception only when live hosting is the sole reason for the existing full tier. Other phases retain their selected tier and cadence. (#611)
- Allow a copy-only or read-only phase crossing into a host with live services (and no other `full`-tier risk factor) to resolve to `standard` via `resolveProcessTier` in `hooks/verification.cjs` (re-exported by `hooks/verification-bridge.cjs`, validated by `schemas/verification.schema.json`) with a required before and after live-service observation, one implementer, one review, and no separate assurance, while phases that delete or mutate still resolve as before. (Alphazedehq#611)
- Record per-phase planning choice between a short reviewed command list and new reusable tooling in `journey_settings.tooling_choice` (`schemas/implementation.schema.json`), `skills/planning-and-design/SKILL.md`, `skills/planning-and-design/references/artifact-grammar.md`, and `skills/bearing-lite/references/planning-assembly.md`, requiring `reason` and `reuse` when new tooling is chosen. (Alphazedehq#609)
- Support per-slice real `inputs` and held `resource` in `schemas/implementation.schema.json`, `hooks/ready-set.cjs`, `hooks/plan-package.cjs` (flagging `false_serial_chain` edges that share no input or resource without refusing the freeze, and forwarding the fields in `waveView`), and `tools/render-dod-manifest.mjs`, and direct the Implementation Orchestrator and planning docs to start every ready slice without wave-level serialization. (Alphazedehq#608)
- Require planning and implementation guidance to run the first implementation slice as a parallel preflight across every target host in dry-run or `--version` form and close any host-building phase by running that repository's real gate on it. (Alphazedehq#610)
- Require integration and landing guidance to run the heavy check before merge when a change edits a table or fixture that other suites read. (Alphazedehq#612)

## [3.0.0-rc.3] - 2026-11-19

### Fixed

- Use the recorded specialist closing return when opening planning review and when freezing the final plan.
- Bind readiness and any adoption evidence to the closing return's own candidate.
- Preserve planning-review, assurance, and protected-completion checks alongside the final-freeze receipt check.
- Require a structured passing final-freeze receipt on both planning handoff routes and document the intake digest comparison.
- Preserve significant SVG text and attribute whitespace while cleaning whitespace-only source lines in rendered DoD Manifests.
- Keep SEIT planning checks within their authorized run budget and tie independent single-run assurance to the original run.

- `sanitizeSvg` in `tools/render-dod-manifest.mjs` drops whitespace-only text outside the root `<svg>` element and clears horizontal whitespace on whitespace-only lines so rendered DoD Manifests emit no whitespace-only lines from leading or inter-element SVG comments. (Alphazedehq#597)
- Record optional `delegate_approval` on the effective authority envelope with the `approver`, required `delegation_ref`, and optional UTC `approved_at`. Preserve the frozen proposal. (Alphazedehq#604)
- Define the Planning Orchestrator's one closing return (`author`, `reason`, `items`, `candidate`, resulting `READY`; resuming the author's own session without counting as a relaunch) in `skills/bearing-lite/references/planning-assembly.md`, and accept one valid closing return closing a `GAPS` session in `hooks/plan-package.cjs` final freeze while refusing unclosed `GAPS`, incomplete records, or a second closing return. (Alphazedehq#593)
- Name the same one closing return path and its record (`author`, `reason`, `items`, `candidate`, resulting `READY`) in `skills/planning-and-design/SKILL.md` and `skills/bearing-lite/references/planning-assembly.md` for a meaning defect found at assembly. (Alphazedehq#595)
- Add `skills/bearing-lite/templates/handoff.md` recording `final_freeze_receipt`, require Implementation Orchestrator intake in `skills/bearing-lite/SKILL.md` and `skills/bearing-lite/references/planning-assembly.md` to verify it and return to planning when absent or `draft`-only, and make `hooks/closeout.cjs` (`mode: "handoff"`) refuse a handoff without a valid `final_freeze_receipt`. (Alphazedehq#594)
- Scope `tools/compile-handoff.mjs` in `skills/bearing-lite/references/pre-packet.md` and `skills/bearing-lite/references/task-state.md` to execution packets (once `implementation.json` and `seit.json` exist) while directing planning (pre-assembly) packets to the Prompt template. (Alphazedehq#596)
- Link directly to the Fellow consultation guide and name its four checkpoints in the Implementation step. (Alphazedehq#600)
- Add a run-once check for each authored/frozen SEIT command (or a recorded pre-implementation reason it cannot run) and its return record to `skills/integration-test/SKILL.md`. (Alphazedehq#603)
- Name `independent validation of a single-run receipt` (validating recorded inputs, digest, and log instead of re-running when a gate or role turn has a one-run budget) in `skills/integration-test/SKILL.md`, `skills/test-engineer/SKILL.md`, and `skills/bearing-lite/references/verification.md`. (Alphazedehq#605)

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

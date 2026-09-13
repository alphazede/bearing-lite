---
type: technical-plan
title: Bearing Delivery Lifecycle Alignment
status: complete
okf_status: active
tags:
  - bearing-lite
  - lifecycle
  - agent-plugin
---

# Bearing Delivery Lifecycle Alignment

## BLUF

Align Bearing Lite around one public delivery lifecycle, one persistent profile contract, deterministic human review artifacts, and explicit planning, implementation, assurance, review, and integration boundaries. The change resolves GitHub issues #87–#91 and adds standards-based GitHub Copilot and Muse Code compatibility without tying Bearing to a provider.

## Baseline and precedence

- Repository: `alphazede/bearing-lite`
- Source baseline: `b5cec79f04f6f6ea506a2ad89bf937aab143d876`
- Owner decisions: `journey.json`, confirmed decisions `DEC-BDL-001` through `DEC-BDL-066`
- Public source of truth: `README.md`
- Supporting public specification: `docs/architecture/bearing-delivery-lifecycle.md`
- Derived views (non-normative): `docs/architecture/bearing-process/lifecycle-context.svg` and `docs/architecture/bearing-process/lifecycle-process-views.svg`
- Issue scope: #87, #88, #89, #90, #91

Current owner decisions outrank stale issue wording and the 0.2.2 contracts where they conflict.

## Current state [reconciled 2026-09-13]

This plan is approved and under execution; it is not complete. `DEC-BDL-060`
authorized implementation without a repeated planning review. Slices S1-S4 and
the mechanical slices S1L, S1E, and S3L have produced author receipts; S5 was
stopped before completion; S5L, S6, S7, and S8 have not run. The full Node suite
is 392/397 with two stale deleted-HTML expectations and three package-inventory
failures, all tracked as `known_contract_gaps` in `seit.json`. No independent
assurance, review, or integration assessment has occurred, and the manual
DoD Manifest visual demonstration remains unavailable under the recorded
browser policy.

## Outcome

A user can start with a Feature Story, Defect, Technical Task, or Change Request and follow a clear path through Intake, Architectural Alignment, Scope Definition, Planning and Design, owner authorization, bounded implementation, assurance, review, Integration Engineer execution assessment, and completion evidence. The generated `<plan-name>-dod-manifest.html` makes the planned and actual work reviewable without becoming execution authority.

## Scope

1. Rewrite the README as a concise onboarding and orientation page with BLUF and SCQA structure.
2. Publish the lifecycle specification. HTML is the DoD Manifest output only; no standalone process HTML page is a deliverable (`DEC-BDL-064`). The retained derived SVG views are accessible non-normative projections of the same ordered contract and are not a mandated modeling format.
3. Replace `lineups.json` and `default-role-lineup.md` with `profiles.json` and one `profiles.schema.json` contract.
4. Add `onboard-bearing` and package the existing agnostic `prompt` skill unchanged.
5. Replace `review.html` with the deterministic Definition of Done Manifest renderer and template.
6. Remove Surveyor and active camp terminology; retain one Integration Engineer with planning and execution sessions and one Test Engineer with planning and assurance sessions.
7. Add configurable development strategy, assurance cadence, concurrency, resume, and Reverify settings.
8. Add a generic deterministic-verification receipt contract with Reverify as an optional backend.
9. Make the root Agent Plugins 1.0 manifest conformant and add GitHub Copilot-specific hooks under `com.github.copilot/`; document Muse Code skill installation and validation.
10. Add public release notes and AI-assisted-development acknowledgements without fabricating GitHub contributor identities.

## Exclusions

- No requirements register is created.
- Historical approved `review.html` files are not migrated.
- No Reverify download occurs during this Lifecycle.
- No npm publication, release tag, GitHub release, deployment, push, merge, or issue closure is authorized by this plan.
- GitHub’s commit-derived Contributors graph is not manually altered.

## Acceptance contracts

| ID | Contract |
|---|---|
| AC-BDL-001 | README and lifecycle specification use the approved public names and show one input-to-evidence flow. |
| AC-BDL-002 | Planning order and bounded reconciliation match the confirmed owner decisions, with the Orchestrator limited to structural readiness. |
| AC-BDL-003 | Implementation supports `single_implementer` and `tdd`, dispatches all dependency-ready independent work concurrently, and never invents behavior. |
| AC-BDL-004 | Test Engineer assurance and Reviewer default to `phase`; Integration Engineer execution defaults to `lifecycle`; each accepts `slice`, `phase`, or `lifecycle`. |
| AC-BDL-005 | Surveyor, Explorer, Crewmate, Navigator, Expedition, active Journey terminology, and their active routing are removed from the new package. |
| AC-BDL-006 | `profiles.json` is the only persistent Bearing configuration; legacy lineup inputs require explicit deterministic migration. |
| AC-BDL-007 | `onboard-bearing` asks settings one at a time and writes only explicit user choices; declining Reverify persists `enabled: false`. |
| AC-BDL-008 | The DoD Manifest has the approved nine sections, fixed human tables, embedded model views, append-only closeout, accessible presentation, and byte-deterministic rendering. |
| AC-BDL-009 | Diagnostic and assurance deterministic-verification receipts remain distinct and bind the exact candidate, claim, backend, version, command, and evidence. |
| AC-BDL-010 | Agent Plugins 1.0 validation passes; VS Code/GitHub Copilot discovers shared skills and Copilot hooks from standard paths; Muse Code validates and can install the skills. |
| AC-BDL-011 | Resume checks liveness once, avoids duplicate dispatch, and continues from durable state without replaying confirmed work. |
| AC-BDL-012 | Documentation impact, completion evidence, recovery, authority, and owner decisions remain visible in the DoD Manifest. |

## Entry criteria

- The checkout lease in `journey.json` is active and still names this repository and baseline.
- All material decisions are confirmed and `open_decisions` is empty.
- The owner authorized implementation in this session.
- The versioned DoD Manifest template `templates/dod-manifest-v1.html` is the implemented visual baseline. `DEC-BDL-055` selected the Grok prototype; that prototype and the AGY comparison preview have since been superseded by the template and were deleted under the current owner planning-repair instruction.

## Implementation sequence

1. Establish schemas, profiles, migration rules, role/session contracts, and host package structure.
2. Update policy hooks and deterministic verification contracts.
3. Add the DoD Manifest template and renderer.
4. Rewrite README, specification, derived views, role references, and release acknowledgement. Do not recreate the deleted process HTML pages or substitute a mandatory diagram dialect for them.
5. Run schema, package, Muse, renderer, documentation, and full test checks.
6. Run Test Engineer assurance and Reviewer at the configured phase boundary.
7. Run the Integration Engineer execution session once against the final stable candidate.

## Documentation impact

README, lifecycle specification, derived views, role skills, reference policies, onboarding guidance, package layout, release notes, and troubleshooting are changed in the same Lifecycle. Link and terminology checks verify discoverability before closeout.

## Exit criteria

- All acceptance contracts have objective PASS evidence or a visible owner-held exception.
- The package contains no active Surveyor or lineup configuration path.
- The DoD Manifest check mode reproduces byte-identical HTML.
- Agent Plugins 1.0, Copilot layout, and Muse skill validation pass.
- `node --test test/*.test.mjs`, `python3 test/schema-validation.py`, `npm pack --dry-run --json`, and `git diff --check` pass.
- Integration Engineer execution assessment reports the approved outcome satisfied or returns explicit gaps.

## Rollback or repair

Changes remain uncommitted until verified. A failing contract receives one bounded repair of the affected write set followed by deterministic recheck. A scope, interface, security, acceptance, or authority change stops dependent work and returns to the owner. Git can restore tracked files; new files can be removed as one bounded rollback.

## Accountable controller

The Orchestrator owns structural readiness, dependency routing, durable state, and evidence presence. Specialist roles own technical judgments. The owner alone authorizes scope changes, publication, and acceptance.

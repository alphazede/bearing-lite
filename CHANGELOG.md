# Changelog

## [Unreleased]

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

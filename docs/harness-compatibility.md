# Harness compatibility matrix (Issue #92)

Version 1.0 · recorded 2026-11-17. This file is the versioned compatibility
record for the packed `@alphazede/bearing-lite` distributable inside each
advertised harness. It is backed by the native acceptance suite; a cell is
`PASS` only when the named test case observed native harness evidence, `FAIL`
when the harness refused a documented path, `UNSUPPORTED` when the host
declares no surface for that capability, `UNVERIFIED` when no native event
could be triggered without operator credentials, and `UNAVAILABLE` when the
harness binary is absent on this machine. A model's statement is never
evidence; Codex execution uses fixed loopback tool calls, so model-refusal
controls are inconclusive by construction and are not used.

## What was run

The suite is opt-in (the default `test/*.test.mjs` gate does not run
`test/native/*`) and installs the actual `npm pack` distributable into
disposable profiles; operator configuration is never touched.

```sh
node --test test/native/harness-acceptance.test.mjs
node --test test/native/codex-hook-discovery.test.mjs
node --test test/native/assurance-dispatch.test.mjs
```

Test-case IDs: `TC-PACK-01` packed identity,
`TC-CODEX-EXEC-01` Codex execution (allowed, blocked, negative control),
`TC-CODEX-FAIL-01..03` missing dependency / failing hook / malformed
response, `TC-CODEX-HOOKS-01` installed hook scripts present,
`TC-CLAUDE-DISC-01` and `TC-CLAUDE-EXEC-UNVERIFIED` Claude,
`TC-MUSE-ISC-01` and `TC-MUSE-PLUG-01` Muse Code,
`TC-AGY-DISC-01` and `TC-AGY-SYMLINK-01` AGY,
`TC-CURSOR-UNAVAIL-01`, `TC-COPILOT-CLI-UNAVAIL-01`, `TC-PI-UNAVAIL-01`,
`TC-VSCODE-UNVERIFIED-01`, `TC-DEEPCODE-UNVERIFIED-01`.
Codex discovery (`hooks/list`, `skills/list`) is proven by the required
`codex-hook-discovery` native gate; this suite adds the execution cases the
D1 gate explicitly does not cover.

## Capability matrix

| Harness and install path | Install and discovery | Skill load and resources | Hook registration | Advisory effect | Blocking enforced | Failure handling |
|---|---|---|---|---|---|---|
| Codex, prepared local marketplace + `plugin marketplace add` + `plugin add` | PASS (`TC-CODEX-DISC`) | PASS (`TC-CODEX-DISC`) | PASS (`TC-CODEX-EXEC-01`, `TC-CODEX-HOOKS-01`) | PASS (`TC-CODEX-EXEC-01`, PreToolUse dispatch only) | PASS (`TC-CODEX-EXEC-01`) | PASS (`TC-CODEX-FAIL-01..03`) |
| Claude Code, `plugin marketplace add` + `plugin install` | PASS (`TC-CLAUDE-DISC-01`) | UNVERIFIED (`TC-CLAUDE-DISC-01`, resources byte-compared; invocation UNVERIFIED) | UNVERIFIED (`TC-CLAUDE-EXEC-UNVERIFIED`) | UNVERIFIED (`TC-CLAUDE-EXEC-UNVERIFIED`) | UNVERIFIED (`TC-CLAUDE-EXEC-UNVERIFIED`) | UNVERIFIED (`TC-CLAUDE-EXEC-UNVERIFIED`) |
| Muse Code, per-skill `skills install` | PASS (`TC-MUSE-ISC-01`) | PASS (`TC-MUSE-ISC-01`) | UNSUPPORTED (`TC-MUSE-ISC-01`) | UNSUPPORTED (`TC-MUSE-ISC-01`) | UNSUPPORTED (`TC-MUSE-ISC-01`) | UNSUPPORTED (`TC-MUSE-ISC-01`) |
| Muse Code, portable bundle `plugins install` | PASS (`TC-MUSE-PLUG-01`) | PASS (`TC-MUSE-PLUG-01`) | UNSUPPORTED (`TC-MUSE-PLUG-01`) | UNSUPPORTED (`TC-MUSE-PLUG-01`) | UNSUPPORTED (`TC-MUSE-PLUG-01`) | UNSUPPORTED (`TC-MUSE-PLUG-01`) |
| AGY, `plugin install` from a copied payload | PASS (`TC-AGY-DISC-01`) | PASS (`TC-AGY-DISC-01`) | UNSUPPORTED (`TC-AGY-DISC-01`) | UNSUPPORTED (`TC-AGY-DISC-01`) | UNSUPPORTED (`TC-AGY-DISC-01`) | UNSUPPORTED (`TC-AGY-DISC-01`) |
| AGY, `plugin install` from the documented symlink root | FAIL (`TC-AGY-SYMLINK-01`) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Cursor editor, Customize Install / local symlink | UNVERIFIED (`TC-CURSOR-UNAVAIL-01`) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Cursor Agent CLI, `--plugin-dir` | UNVERIFIED (`TC-CURSOR-UNAVAIL-01`) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| GitHub Copilot in VS Code, Chat: Install Plugin From Source | UNVERIFIED (`TC-VSCODE-UNVERIFIED-01`) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| GitHub Copilot CLI, `plugin marketplace add` + `plugin install` | UNAVAILABLE (`TC-COPILOT-CLI-UNAVAIL-01`) | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| Pi, `pi install npm:@alphazede/bearing-lite` | UNAVAILABLE (`TC-PI-UNAVAIL-01`) | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |
| DeepCode, copy `skills/` into the skills directory | UNVERIFIED (`TC-DEEPCODE-UNVERIFIED-01`) | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |

Qwen Code, Kimi Code, and Grok Build are not advertised clients (legacy
metadata only) and are excluded from this matrix. Rerun the three native
commands after any integration, distributable-layout, or harness-version
change and refresh the evidence table; when a harness binary appears or a
blocker changes, the matching test fails until the row is re-probed.

## Last run evidence (2026-11-17, Ubuntu 26.04, Linux 7.0.0-43-generic x64)

Plugin `@alphazede/bearing-lite` 2.0.3, source revision
`0421caf45a6986542c71d3b10f70a21e8f47fa7e`, distributable sha256
`ba3a14b045b4b136d335e860c33772d74567b0f2aebe42ae38d9d370e536fab2`
(`npm pack` tarball; installed copies byte-compared against it). Codex
`codex-cli 0.169.0` with pinned release target `0.162.1`: native tests run
at 0.169.0 are recorded as compatibility evidence, not pinned qualification.
Claude Code `2.1.326` installed the marketplace artifact and inventoried
16 skills plus the `SessionStart, PreToolUse, Stop, SubagentStop` hook
events; a disposable profile reported `Not logged in`, so no hook event
could be fired. Muse Code `1.4.23 (1.4.23-R8977.1)` installed all 16
skills per-skill and accepted the portable bundle with a recorded package
digest and an empty hook list. AGY `1.5.10` reported its version to the suite;
its copy install registered 16 skills and 0 hooks while the documented symlink
root was refused. Cursor Agent `2026.11.13-eacade1` required
authentication even for marketplace listing; Copilot CLI and Pi binaries
are absent on this machine (Copilot's shipped shim reports itself missing).

Native observations worth keeping: Codex surfaced the pre-tool denial
("Command blocked by PreToolUse hook") in the tool return and wrote the
hook's reservation into the fixture record; the disabled-plugin control
removed both effects; a missing, failing, or malformed hook all left the
session alive with no block (fail-open for advisory dispatch). The
`SessionStart` hook context did not appear in the transcript or the
first provider request on this build; it is observable only through the
model-context channel, so advisory evidence rests on the reservation and
denial channels that are visible. SessionStart, Stop, and SubagentStop
effects, and visible advisory delivery for activation, closeout, test
engineering, the orchestrator write lock, and git-sync, remain
unexercised: `TC-CODEX-HOOKS-01` proves only that all five declared hook
scripts are installed byte-identical to the packed artifact, and
`TC-CODEX-EXEC-01` exercises PreToolUse dispatch only. Claude skill
invocation remains UNVERIFIED for the same reason (no authenticated
session in a disposable profile); `TC-CLAUDE-DISC-01` now fails when a
referenced resource such as `assurance-policy.md` is missing from the
installed artifact.

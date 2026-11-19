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
| AGY, `plugin install` from a copied payload | PASS (`TC-AGY-DISC-01`) | PASS (`TC-AGY-DISC-01`) | PASS (`TC-AGY-DISC-01`, 7 hooks via root `hooks.json`) | PASS (`SessionStart` `injectSteps`; `Stop` quiet on advisory) | PASS (`PreToolUse` `decision: "deny"`; `Stop` `decision: "continue"`; no `SubagentStop`) | PASS (malformed/empty fail-open, exit 0) |
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
`bea35c40d9c28042d1545771de64f593044ad81a` (main) with the packaged-skill-count fix applied, distributable sha256
`90ad1f6e23b6e9c1d32e00a316875db1f2bb4da8e81fce04cbb50877c1ff5dc6`
(`npm pack` tarball; installed copies byte-compared against it). Codex
`codex-cli 0.169.0` with pinned release target `0.162.1`: native tests run
at 0.169.0 are recorded as compatibility evidence, not pinned qualification.
Claude Code `2.1.326` installed the marketplace artifact and inventoried
17 skills plus the `SessionStart, PreToolUse, Stop, SubagentStop` hook
events; a disposable profile reported `Not logged in`, so no hook event
could be fired. Muse Code `1.4.23 (1.4.23-R8977.1)` installed all 17
skills per-skill and accepted the portable bundle with a recorded package
digest and an empty hook list. AGY `1.5.10` reported its version to the suite;
its copy install registered 17 skills and 0 hooks while the documented symlink
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

AGY `1.5.12` (2026-11-19 live probe and candidate plugin install) validates root `hooks.json` with `16 skills` and `7 hooks` (`bearing-lite-activation`, `bearing-lite-assurance-dispatch`, `bearing-lite-te-write`, `bearing-lite-orchestrator-write-lock`, `bearing-lite-closeout`, `bearing-lite-te-completion`, `bearing-lite-git-sync`), rejecting Claude-style `hookSpecificOutput` via strict `protojson` unmarshaling and omitting `SubagentStop` (unsupported on AGY). Via `hooks/com.google.antigravity/host.cjs`, live `agy2` runs proved `SessionStart` `injectSteps` system-context injection, `PreToolUse` `decision: "deny"` tool blocking on `run_command`/`write_file`/`edit_file`, and all 7 installed hooks completing on `SessionStart`, `PreToolUse`, and `Stop` with `continuationActive` re-entry handling.

## Decision-adapter column

Updated 2026-11-17 by slice S11. Observer: Implementer. This section states
which already registered events can invoke the decision adapter. It does
not change the capability matrix above.

`hooks/decision-adapter.cjs` is called from the already registered
`host.cjs` SessionStart and Stop handlers. No new hook event is registered.
No cell is `native-proven`. A `native-proven` cell would name a
`SEIT-NATIVE-ADAPTER` receipt on this candidate. No such receipt is recorded
here. `component-only` means the handler calls the adapter in process and
native invocation is unverified.

The four events are the keys of `hooks/hooks.json`: `SessionStart`,
`PreToolUse`, `Stop`, and `SubagentStop`. Cursor's map uses `sessionStart`
and `stop` for the first and third. `PreToolUse` cannot invoke the adapter:
it runs only after a model has asked for a tool (`hooks/hooks.json:16-47`).
`SubagentStop` registers `te-host.cjs` only (`hooks/hooks.json:82-90`).

| Host | SessionStart | PreToolUse | Stop | SubagentStop |
| --- | --- | --- | --- | --- |
| Claude Code | component-only. Limitation: `hooks/hooks.json:4-12` registers `host.cjs`, which calls the adapter when that registration timeout is present; the 2026-11-17 run did not fire the event (lines 70-72 of this file). | unsupported. Limitation: registered at `hooks/hooks.json:16-47`, but the event follows a model tool request, so it is not an adapter call site. Native invocation was not fired. | component-only. Limitation: `hooks/hooks.json:50-60` registers `host.cjs`, which calls the adapter when that registration timeout is present; Stop effects are unexercised (lines 89-93 of this file). | unsupported. Limitation: `hooks/hooks.json:82-90` registers `te-host.cjs` only. |
| Codex | component-only. Limitation: hook scripts are installed and `host.cjs` calls the adapter when the registration timeout is present; the SessionStart effect is unexercised (lines 86-89 of this file). | unsupported. Limitation: `TC-CODEX-EXEC-01` proves PreToolUse assurance dispatch, not an adapter. The event follows a model tool request. | component-only. Limitation: `host.cjs` calls the adapter when the registration timeout is present; Stop effects are unexercised (lines 89-93 of this file). | unsupported. Limitation: `hooks/hooks.json:82-90` registers `te-host.cjs` only; the effect is unexercised. |
| Cursor | unverified. Limitation: `hooks/com.cursor/hooks.json:4-8` registers `sessionStart` with `--host=cursor` and no declared timeout, so the handler skips inference; `TC-CURSOR-UNAVAIL-01`. Native invocation was not fired. | unsupported. Limitation: `hooks/com.cursor/hooks.json:17-27` registers `preToolUse` after a model tool request. Not an adapter call site. | unverified. Limitation: `hooks/com.cursor/hooks.json:9-16` registers `stop` with `--host=cursor` and no timeout, so the handler skips inference; `TC-CURSOR-UNAVAIL-01`. | unsupported. Limitation: `hooks/com.cursor/hooks.json` does not register `SubagentStop`. |
| Muse Code | unsupported. Limitation: hook registration is `UNSUPPORTED` (lines 45-46 of this file, `TC-MUSE-ISC-01` and `TC-MUSE-PLUG-01`). No registered event can invoke an adapter. An Orchestrator command would be a model tool call. | unsupported. Limitation: same as SessionStart. No hook surface. | unsupported. Limitation: same as SessionStart. No hook surface. | unsupported. Limitation: same as SessionStart. No hook surface. |
| AGY | component-only. Limitation: root `hooks.json` registers `hooks/com.google.antigravity/host.cjs activation` -> `host.cjs` with `timeout: 15`, which calls the adapter when `decision_choice` is present; the 2026-11-19 live AGY `1.5.12` run did not include `decision_choice`. | unsupported. Limitation: registered in root `hooks.json`, but `PreToolUse` follows a model tool request, so it is not an adapter call site. | component-only. Limitation: root `hooks.json` registers `hooks/com.google.antigravity/host.cjs closeout` -> `host.cjs` with `timeout: 15`; advisory Stop stays quiet on AGY. | unsupported. Limitation: AGY supports `SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, and `PostToolUse` only; `SubagentStop` is ignored. |
| Oh My Pi | unsupported. Limitation: the host table in `hooks/com.anthropic.claude-code/mapping.md:15-26` does not list Oh My Pi, and this file's capability matrix has no row. This package declares no hook surface. | unsupported. Limitation: same as SessionStart. No declared hook surface. | unsupported. Limitation: same as SessionStart. No declared hook surface. | unsupported. Limitation: same as SessionStart. No declared hook surface. |
| DeepCode | unsupported. Limitation: `hooks/com.anthropic.claude-code/mapping.md:24` records no hooks (skills-only). `TC-DEEPCODE-UNVERIFIED-01` is discovery only. | unsupported. Limitation: same as SessionStart. No hook surface. | unsupported. Limitation: same as SessionStart. No hook surface. | unsupported. Limitation: same as SessionStart. No hook surface. |
| Pi | unsupported. Limitation: `hooks/com.anthropic.claude-code/mapping.md:23` records no command hooks. The Pi binary was absent (`TC-PI-UNAVAIL-01`, line 53 of this file). | unsupported. Limitation: same as SessionStart. No command-hook surface. | unsupported. Limitation: same as SessionStart. No command-hook surface. | unsupported. Limitation: same as SessionStart. No command-hook surface. |

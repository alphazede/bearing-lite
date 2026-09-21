# Verified host mapping

This adapter is the verified native mapping for hosts that share a
session-start / stop command hook. Coverage is **partial**: activation and
closeout are executable; transition-order and protected-action stay
procedural. The Orchestrator write-set lock is executable only where the
host has a native pre-write deny.

## Hosts

| Host | Plugin install | Hooks | Coverage |
|---|---|---|---|
| Claude Code | `.claude-plugin/` marketplace | `hooks/hooks.json` | partial |
| Codex | `.codex-plugin/` + `.agents/plugins/` | `hooks/hooks.json` | partial |
| Grok Build | `.grok-plugin/` marketplace | `hooks/hooks.json` | partial |
| Cursor | `.cursor-plugin/` | `hooks/com.cursor/hooks.json` (`sessionStart`, `stop`) | partial |
| Kimi Code | `.kimi-plugin/plugin.json` | manifest `hooks` array | partial |
| AGY | `.agy/` (strict `plugin.json`) | none | skills-only |
| Pi | `package.json` `"pi"` + `pi-package` | none (TypeScript extensions, not command hooks) | skills-only |
| DeepCode | `.deepcode/skills` or interoperable `.agents/skills` discovery | none | skills-only |
| Qwen Code | Agent Plugins 1.0 `plugin.json` | none (no Qwen-specific hook namespace) | skills-only |
| GitHub Copilot | Agent Plugins 1.0 `plugin.json` + `com.github.copilot/` | `com.github.copilot/hooks/hooks.json` (`SessionStart`, `PreToolUse`, `Stop`, `SubagentStop`) | partial |

Do **not** set `hooks` on the root Agent Plugins 1.0 `plugin.json`, or on Claude,
Codex, or Grok host manifests. Root `hooks` is outside the closed Agent Plugins
1.0 field set. Claude, Codex, and Grok auto-load `hooks/hooks.json`; declaring
both is a duplicate-file error. GitHub Copilot in VS Code discovers plugin hooks
from `com.github.copilot/hooks/hooks.json`.

Skill-copy into a host skills directory does **not** register plugin hooks.
To carry the Orchestrator write-set lock, merge `hooks/skill-copy-write-lock.json`
into the host settings and point the command at `hooks/orchestrator-write-lock.cjs`.
If that fragment is not installed, activation records `write_lock: absent`
(a typed capability gap, not silent). Plugin install or disable uses the host's
native controls. Skill-copy and plugin install do not reload already-running
sessions. Bearing Lite never copies adapters into global hook configuration.

## Event map

| Host event names | Bearing class | Executable? |
|---|---|---|
| `SessionStart`, `sessionStart`, `session_start` | activation | yes, advisory |
| `Stop`, `stop` | closeout | yes, advisory only |
| `Stop`, `stop` | git-sync (`hooks/git-sync.cjs`) | yes, advisory only: fast-forwards the session checkout from origin, moves an unchecked-out `main` ref, and names unpushed, diverged, or upstream-less branches; never merges, pushes, or blocks |
| `PreToolUse`, `preToolUse`, `beforeShellExecution`, `apply_patch` | te_test_write | only where the host has a native write-time deny |
| `PreToolUse`, `preToolUse`, `beforeShellExecution`, `apply_patch` | orchestrator write-set lock | only where the host has a native write-time deny; otherwise documented fallback |
| `Stop`, `stop`, `SubagentStop`, `subagentStop` | te_completion | only where the host has a native completion or child-stop deny |
| any other host event | none | unmapped; fail open as `UNAVAILABLE` |

`hooks/com.anthropic.claude-code/host.cjs` owns activation and closeout and
maps no Test Engineering class. `hooks/te-host.cjs` owns te_test_write and
te_completion and maps neither of the original four. `hooks/orchestrator-write-lock.cjs`
is a pure evaluator invoked on the same write-time events; it is not a fifth
original class. The adapters are registered separately, and a `Stop` event
reaches activation/closeout and TE completion.

The shared planning-review evaluator is used by transition and closeout when a
client supplies a structured `planning_review` record. Current session-start /
stop mappings cannot derive that nested record safely, so Claude Code, Codex,
Grok Build, Cursor, Kimi, and GitHub Copilot remain partial and the check is
procedural there. AGY, Pi, DeepCode, and Qwen Code remain skills-only. Do not
claim full planning-review enforcement for any of these hosts until a native
event supplies the complete record.

The per-declared-phase-or-wave assurance record
(`skills/bearing-lite/references/assurance-policy.md`) is evaluated by the same
`transition` class through the `assurance_transition` action_kind. No mapped
host exposes a hook event that carries the frozen declaration and the visible
task record, so the assurance budget is procedural on every mapped host:
Claude Code, Codex, Grok Build, Cursor, Kimi Code, and GitHub Copilot stay
partial, and AGY, Pi, DeepCode, and Qwen Code stay skills-only. No host may
advertise an enforcement of the assurance budget it cannot perform.

The adapter accepts snake_case and camelCase (`hook_event_name` /
`hookEventName`, `cwd` / `workspaceRoot`).

## Test Engineering classes

`te_test_write` and `te_completion` are **additional** classes, shipped by
`hooks/te-capability.cjs` and `hooks/te-host.cjs`. They do not rename or
replace activation, closeout, transition-order, or protected-action, and they
do not reuse those classes' outcome tokens. Their verdicts are `ALLOW`,
`DENY_ROUTE_TO_TE`, `DENY_RECEIPT_REQUIRED`, and `UNAVAILABLE`.

Bearing Lite ships no Test Engineering evaluator and no Test Engineering
method content. The adapter resolves the `test-engineering` capability, loads
the evaluator at `skills/test-engineering/hooks/te-evaluator.cjs` when that
capability is present in the workspace, builds the request from the real Git
checkout and the visible coordinator- or orchestrator-authored plan, and
returns the evaluator verdict unchanged.

| Capability state | Class result |
|---|---|
| neither selected nor required | `UNAVAILABLE`; the class fails open and this is not a failure |
| selected or required, evaluator absent | `UNAVAILABLE` with `code: typed_capability_gap`; a typed gap, never silent success |
| selected or required, evaluator loaded | the evaluator verdict, verbatim |

Trusted assignment comes from the visible coordinator- or
orchestrator-authored plan, never from the tool payload or the transcript.
Candidate state comes from the
installed Git executable: the committed `diff_base..HEAD` change plus the
working tree, scoped to the trusted write set. An empty trusted scope covers
nothing, so unrelated shared dirt never enters the candidate. Derived runtime
state under the Bearing runtime directory is never a candidate change.

An artifact on disk is never a local pass token; only the evaluator reads it.
An `ALLOW` completion verdict is not user acceptance and grants no planning or
publication authority.

### Host honesty

`native` means the host exposes a verified hard deny for that channel.
Everything else is `UNAVAILABLE`: the class is procedural on that host and
this adapter must not advertise enforcement it cannot perform.

| Host | te_test_write channel | te_completion at parent stop | te_completion at child stop |
|---|---|---|---|
| Claude Code | native `PreToolUse` deny | native `Stop` deny | native `SubagentStop` deny |
| Codex | native `PreToolUse` deny | native `Stop` deny | native `SubagentStop` deny |
| Grok Build | native `PreToolUse` deny | native `Stop` deny | native `SubagentStop` deny |
| Cursor | native `preToolUse` and `beforeShellExecution` deny | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| Kimi Code | te_test_write UNAVAILABLE | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| Pi | te_test_write UNAVAILABLE | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| AGY | te_test_write UNAVAILABLE | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| DeepCode | te_test_write UNAVAILABLE | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| Qwen Code | te_test_write UNAVAILABLE | te_completion UNAVAILABLE | child te_completion UNAVAILABLE |
| GitHub Copilot | native `PreToolUse` deny | native `Stop` deny | native `SubagentStop` deny |

Cursor's `stop` guidance message is advisory text, not a hard completion
block, and Cursor exposes no distinct hard child-stop deny; neither is
registered as one. Kimi Code, Pi, AGY, DeepCode, and Qwen Code carry no
verified native Test Engineering blocking in this adapter, so
`hooks/te-host.cjs` returns `UNAVAILABLE` for every class on those hosts rather
than claiming an enforcement it cannot deliver.

GitHub Copilot in VS Code is a native TE host. Agent Plugins 1.0 discovers
`com.github.copilot/hooks/hooks.json` and expands `${PLUGIN_ROOT}`; the TE
commands quote that path and pass `--host=copilot`. Copilot `PreToolUse` denies
through `hookSpecificOutput.permissionDecision`. Copilot `Stop` denies through
`hookSpecificOutput` with `hookEventName` `Stop`, `decision` `block`, and
`reason`. Copilot `SubagentStop` denies through a top-level `decision` block
and `reason`. `Stop` and `SubagentStop` carry `stop_hook_active`; a true
re-entry terminates as quiet success so a deny cannot loop. Transition-order,
protected-action, planning-review, and assurance-budget stay procedural.
This Copilot mapping does not yet register the Orchestrator write-set lock;
use the documented fallback until that host file is wired.

## Orchestrator write-set lock

`hooks/orchestrator-write-lock.cjs` denies Orchestrator sessions (no
`BEARING_ROLE`, empty, or `orchestrator`) writing `*-technical-plan.md`,
`design.md`, `workspace.md`, `seit.json`, `implementation.json`,
`*-dod-manifest.html`, `repository-map.md`, or `docs/coe/**`. Refusal names
the owning role and the dispatch command (`BEARING_ROLE=<role>`). A session
with a non-Orchestrator `BEARING_ROLE` is allowed. Dispatch every specialist
and stage session as a separate process with `BEARING_ROLE` set. Locked
basenames match at any path (`/tmp/workspace.md`, nested `x/docs/coe/y.md`);
that breadth is intentional, not a repo-root-only check.

| Host | write-set lock |
|---|---|
| Claude Code, Codex, Grok Build, Cursor | native `PreToolUse` / Cursor write-time deny |
| GitHub Copilot, Kimi Code, Pi, AGY, DeepCode, Qwen Code, Muse Code | no lock in this mapping; fallback is procedural plus `write_lock: absent` on skill-copy |

Activation receipts include `write_lock: present` when plugin `hooks.json`
wires the evaluator, otherwise `write_lock: absent`.

## Derived fields

The host event supplies session metadata. The adapter reads visible Markdown
under `cwd` (bounded; skips `skills/`, `hooks/`, `test/`, and dependency
trees) and sets only:

| Bearing field | Source |
|---|---|
| `plan_present` | a Markdown file contains a `task_id`, `assigned_role`, non-placeholder journey marker, or `checkout_lease` block |
| `router_invoked` | a non-placeholder `- journey:` setting is present, including the Journey identity nested inside the `checkout_lease` block |
| `assigned_role` | active task `assigned_role` when not `unassigned` or `<…>` |
| `next_action` / `next_action_known` | active task `next_action` when not a placeholder |
| closeout handoff fields | matching task-record keys when present. Receipt `verdict` is a closed role-return token; task `outcome` is approved intent and is not mapped into the receipt |

`assigned_role` and `router_invoked` are **not** inferred from the tool-call
payload. Missing values stay missing, so activation advises the router instead
of inventing context.

The Orchestrator writes the visible `checkout_lease` before any planning write
or dispatch; its nested non-placeholder Lifecycle identity is the
Router-invoked signal during planning. The plan-level lifecycle setting is
recorded later at the integrated owner review.

## Outcome translation

| Outcome | Host JSON | Process exit |
|---|---|---|
| `ADVISE`, `REROUTE`, `UNAVAILABLE` on activation or a discoverable-Journey first-pass Stop | `hookSpecificOutput.additionalContext` | always `0` |
| Stop/SubagentStop re-entry (`stop_hook_active`) | quiet success (empty JSON; no `additionalContext`) | always `0` |
| Stop/SubagentStop with no discoverable Journey | quiet success (empty JSON; no `additionalContext`) | always `0` |
| first-pass Stop/SubagentStop with a discoverable Journey | `hookSpecificOutput.additionalContext` | always `0` |
| `BLOCK` | JSON `decision: "block"` only; this mapping never requests protected completion | always `0` |
| Copilot `PreToolUse` deny | `hookSpecificOutput.permissionDecision` `"deny"` | always `0` |
| Copilot `Stop` deny | `hookSpecificOutput` `{ hookEventName: "Stop", decision: "block", reason }` | always `0` |
| Copilot `SubagentStop` deny | top-level `{ decision: "block", reason }` | always `0` |
| Copilot `Stop`/`SubagentStop` re-entry (`stop_hook_active`) | quiet success (empty JSON) | always `0` |

Stop advice does not start another turn. Claude Code and Grok Build continue
the conversation when Stop returns `additionalContext`. Codex continues only
on `decision: "block"` and rejects Stop `additionalContext`. Kimi Code and
GitHub Copilot run this same adapter. Those wires omit advisory Stop context.
`decision: "block"` is the only continue request. Cursor stop commands pass
`--host=cursor` and keep advice as `additional_context`. `followup_message`
is sent only for `decision: "block"` and is not a completion deny. Pi, AGY,
DeepCode, and Qwen Code register no stop hook.

A discoverable Journey is a visible plan with a `task_id`, `assigned_role`,
non-placeholder journey marker, or `checkout_lease` block. Empty cwd and
`stop_hook_active` re-entry stay quiet. Never map policy or infrastructure to
a non-zero exit.

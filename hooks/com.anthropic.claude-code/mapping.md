# Verified host mapping

This adapter is the verified native mapping for hosts that share a
session-start / stop command hook. Coverage is **partial**: activation and
closeout are executable; transition-order and protected-action stay
procedural. The Orchestrator write-set lock is executable only where the
host has a native pre-write deny.

## Hosts

Qwen Code, Kimi Code, and Grok Build are no longer supported. Their entries
below describe retained legacy formats, not maintained or release-qualified
integrations.

| Host | Plugin install | Hooks | Coverage |
|---|---|---|---|
| Claude Code | `.claude-plugin/` marketplace | `hooks/hooks.json` | partial |
| Codex | `.codex-plugin/` via the prepared marketplace from `tools/prepare-codex-plugin.mjs` | `hooks/hooks.json` | partial |
| Grok Build | legacy `.grok-plugin/` metadata | `hooks/hooks.json` | unsupported |
| Cursor | `.cursor-plugin/` | `hooks/com.cursor/hooks.json` (`sessionStart`, `stop`) | partial |
| Kimi Code | legacy `.kimi-plugin/plugin.json` | manifest `hooks` array | unsupported |
| AGY | `.agy/` (strict `plugin.json`) | none | skills-only |
| Pi | `package.json` `"pi"` + `pi-package` | none (TypeScript extensions, not command hooks) | skills-only |
| DeepCode | `.deepcode/skills` or interoperable `.agents/skills` discovery | none | skills-only |
| Qwen Code | legacy Agent Plugins 1.0 metadata | none | unsupported |
| GitHub Copilot | Agent Plugins 1.0 `plugin.json` + `com.github.copilot/` | `com.github.copilot/hooks/hooks.json` (`SessionStart`, `PreToolUse`, `Stop`, `SubagentStop`) | partial |

Do **not** set `hooks` on the root Agent Plugins 1.0 `plugin.json`, or on Claude,
Codex, or Grok host manifests. Root `hooks` is outside the closed Agent Plugins
1.0 field set. Claude, Codex, and Grok auto-load `hooks/hooks.json`; declaring
both is a duplicate-file error. GitHub Copilot in VS Code discovers plugin hooks
from `com.github.copilot/hooks/hooks.json`.

Codex 0.162.1 registers no plugin hooks, silently, when the installed root
`plugin.json` carries `$schema`. Codex therefore installs from the local
marketplace that `tools/prepare-codex-plugin.mjs --out <new dir>` prepares: the
same package bytes plus `.codex-plugin/`, with only root `$schema` omitted.
`node --test test/native/codex-hook-discovery.test.mjs` proves registration
(8 hooks, all skills, none when disabled), not invocation.

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
Cursor, and GitHub Copilot remain partial and the check is
procedural there. AGY, Pi, and DeepCode remain skills-only. Do not
claim full planning-review enforcement for any of these hosts until a native
event supplies the complete record.

The per-declared-phase-or-wave assurance record still supports read-only
`transition` evaluation through `assurance_transition`. The bound pre-dispatch
barrier below consumes that same evaluator and visible task record before
launch. Unbound legacy flows remain procedural; they are not native proof.

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
protected-action and planning-review stay procedural; bound assurance dispatch is registered separately below.
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


## Bound assurance dispatch capability

`hooks/assurance-dispatch.cjs` makes the existing assurance evaluator a
mandatory barrier for the explicitly bound flow in
[assurance-policy.md](../../skills/bearing-lite/references/assurance-policy.md#mandatory-bound-dispatch-209--210).
General transition-order and protected-action remain procedural. Missing or
invalid bound state is a typed evidence gap and denies launch; ordinary work
without a binding stays open. Hook infrastructure that never invokes the
adapter is a host gap, not a passing budget check.

| Host | Barrier wire / registration | Test status |
|---|---|---|
| Codex | common `PreToolUse`, native `permissionDecision: deny` | installed-plugin native sentinel on 0.163.0; discovery separately; release target 0.162.1 requires its own run |
| Claude Code | common `PreToolUse`, nested `permissionDecision: deny` | component replay; native qualification not run |
| Cursor | `preToolUse` for agent/MCP launches; `beforeShellExecution` for shell | component replay; native qualification not run |
| GitHub Copilot | `PreToolUse`, nested `permissionDecision: deny` | component replay; native qualification not run / client unavailable locally |
| AGY, Pi, DeepCode, skill-copy | no registered barrier | skills-only / procedural |
| Qwen Code, Kimi Code, Grok Build | no maintained barrier | unsupported; excluded from native tests |

Cursor's generic `preToolUse` shell event defers to `beforeShellExecution`,
so one shell launch consumes once. The shell hook reads the documented
`command`/`cwd` envelope and returns native `permission: deny`; generic agent
launches read `tool_name` and `tool_input`. All registrations cover the full
relevant event, independent of prompt wording. Shell wrappers or scripts
inside a frozen slot must themselves have the authorized bounded invocation
contract; no hook inspects or claims to meter arbitrary subprocess internals.

`test/assurance-dispatch.test.mjs` is real module/CLI/filesystem component
replay, not native host evidence. `test/native/assurance-dispatch.test.mjs`
installs the candidate into isolated Codex config and drives its real tool
loop with an owned loopback protocol driver. The allowed sentinel starts;
excess launches do not; repair closes deterministically. It makes no real
provider call. An absent native tool, missing trust or wrong release pin is a
typed qualification gap, never an inferred native pass for another host.

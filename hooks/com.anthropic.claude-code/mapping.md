# Verified host mapping

This adapter is the verified native mapping for hosts that share a
session-start / stop command hook. Coverage is **partial**: activation and
closeout are executable; transition-order and protected-action stay
procedural.

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

Do **not** set `hooks` on Claude, Codex, or Grok host manifests. Those hosts
auto-load `hooks/hooks.json`; declaring both is a duplicate-file error.

Skill-copy into a host skills directory does **not** register hooks. Plugin
install or disable uses the host's native controls. Bearing Lite never copies
adapters into global hook configuration.

## Event map

| Host event names | Bearing class | Executable? |
|---|---|---|
| `SessionStart`, `sessionStart`, `session_start` | activation | yes, advisory |
| `Stop`, `stop` | closeout | yes, advisory only |
| `PreToolUse`, `preToolUse`, `beforeShellExecution`, `apply_patch` | te_test_write | only where the host has a native write-time deny |
| `Stop`, `stop`, `SubagentStop`, `subagentStop` | te_completion | only where the host has a native completion or child-stop deny |
| any other host event | none | unmapped; fail open as `UNAVAILABLE` |

`hooks/com.anthropic.claude-code/host.cjs` owns activation and closeout and
maps no Test Engineering class. `hooks/te-host.cjs` owns te_test_write and
te_completion and maps neither of the original four. The two adapters are
registered separately, and a `Stop` event reaches both.

The shared planning-review evaluator is used by transition and closeout when a
client supplies a structured `planning_review` record. Current session-start /
stop mappings cannot derive that nested record safely, so Claude Code, Codex,
Grok Build, Cursor, and Kimi remain partial and the check is procedural there.
AGY, Pi, and DeepCode remain skills-only. Do not claim full planning-review
enforcement for any of these hosts until a native event supplies the complete
record.

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
checkout and the coordinator-authored plan, and returns the evaluator verdict
unchanged.

| Capability state | Class result |
|---|---|
| neither selected nor required | `UNAVAILABLE`; the class fails open and this is not a failure |
| selected or required, evaluator absent | `UNAVAILABLE` with `code: typed_capability_gap`; a typed gap, never silent success |
| selected or required, evaluator loaded | the evaluator verdict, verbatim |

Trusted assignment comes from the visible coordinator-authored plan, never
from the tool payload or the transcript. Candidate state comes from the
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

Cursor's `stop` guidance message is advisory text, not a hard completion
block, and Cursor exposes no distinct hard child-stop deny; neither is
registered as one. Kimi Code, Pi, AGY, and DeepCode carry no verified native
Test Engineering blocking at all, so `hooks/te-host.cjs` returns `UNAVAILABLE`
for every class on those hosts rather than claiming an enforcement it cannot
deliver.

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

The Router writes the visible `checkout_lease` before any planning write or
dispatch; its nested non-placeholder Journey identity is the Router-invoked
signal during planning. The plan-level Explorer-versus-Expedition value is
recorded later at the route review.

## Outcome translation

| Outcome | Host JSON | Process exit |
|---|---|---|
| `ADVISE`, `REROUTE`, `UNAVAILABLE` on activation or a discoverable-Journey first-pass Stop | `hookSpecificOutput.additionalContext` | always `0` |
| Stop/SubagentStop re-entry (`stop_hook_active`) | quiet success (empty JSON; no `additionalContext`) | always `0` |
| Stop/SubagentStop with no discoverable Journey | quiet success (empty JSON; no `additionalContext`) | always `0` |
| first-pass Stop/SubagentStop with a discoverable Journey | `hookSpecificOutput.additionalContext` | always `0` |
| `BLOCK` | JSON `decision: "block"` only; this mapping never requests protected completion | always `0` |

A discoverable Journey is a visible plan with a `task_id`, `assigned_role`,
non-placeholder journey marker, or `checkout_lease` block. Empty cwd and
`stop_hook_active` re-entry stay quiet. Never map policy or infrastructure to
a non-zero exit.

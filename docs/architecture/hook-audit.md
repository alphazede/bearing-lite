# Hook audit: which shipped hooks earn their cost

This records the audit of every hook registration the package currently
ships (issue #139). One mark per hook × event × host: **keep**,
**drop**, or **quiet-unless-gated** (silent unless a named gate holds).
Inventory is from the live manifests, not from the issue text:

| Manifest | Hosts that load it |
|---|---|
| `hooks/hooks.json` | Claude Code, Codex (via `tools/prepare-codex-plugin.mjs`), Grok Build |
| `hooks/com.cursor/hooks.json` | Cursor (via `.cursor-plugin/plugin.json`) |
| `com.github.copilot/hooks/hooks.json` | GitHub Copilot in VS Code |
| `.kimi-plugin/plugin.json` `hooks` array | Kimi Code (retained legacy metadata; unsupported per `CONTRIBUTING.md` and the mapping) |

Hosts with no hook registration — AGY, Pi, DeepCode, Qwen Code, and the
root `plugin.json` (which must not declare `hooks`) — have no rows.
`hooks/skill-copy-write-lock.json` is the documented skill-copy fragment
for the same `orchestrator-write-lock.cjs` module, not a new hook.

## Mark legend

- **keep** — hard enforcement or standing advisory whose removal would
  drop a contract-covered protection. No tenant is harmed by an `allow`.
- **quiet-unless-gated** — silent when the gate is false; speaks only
  context (or, for TE denies, blocks exactly once; a re-fired stop is
  silent). The gate is named in the row.
- **drop** — unused on every host. **None.** Every registered hook
  enforces behavior pinned by a test or contract below; dropping any
  one would remove a shipped protection, so no drop is taken in this
  audit. Removing the legacy Kimi rows (pinned at 2 by
  `test/plugin-manifest.test.mjs`) is an owner decision, not taken here.

## Findings

1. **No shipped adapter maps stop `additionalContext` to a follow-up.**
   The only `followup_message` producer is `hooks/cursor-stop.cjs`, and
   only for `decision: "block"` (a hook continue request). Advisory stop
   text is kept as `additional_context` on Cursor and omitted on every
   other wire. `test/cursor-stop.test.mjs` and `test/hook-quiet.test.mjs`
   pin this.
2. **Cursor `loop_count` re-entry was missing (fixed here).** Cursor
   sends `loop_count` ≥ 1 on a stop re-fired after a real follow-up.
   `hooks/com.anthropic.claude-code/host.cjs` and `hooks/git-sync.cjs`
   now stay quiet there, matching the existing `stop_hook_active` rule.
3. **TE stop re-entry was Copilot-only; extended to every native host.**
   `hooks/te-host.cjs` now returns quiet success on `stop_hook_active`
   for Claude Code, Codex, and Grok Build too, so a completion deny
   cannot loop on those hosts either.

## Rows

### `hooks/hooks.json` — Claude Code, Codex, Grok Build

| Hook | Event | Mark | Gate / reason | Enforces | Test evidence | Cost |
|---|---|---|---|---|---|---|
| `hooks/com.anthropic.claude-code/host.cjs` | `SessionStart` | quiet-unless-gated | explicit `bearing_session` current-task binding; unbound → `{}` | Activation advisory: bound work routes through the router skill; `write_lock` present/absent is recorded | `test/task-opt-in.test.mjs`, `test/host-mapping.test.mjs`, `test/hook-contract.test.mjs` | Bounded Markdown scan (≤20 files, 256 KiB, depth 3), JSON stdout |
| `hooks/assurance-dispatch.cjs` | `PreToolUse` | keep | hard barrier when bound; `INACTIVE` when unbound | Reserves launch slots against the frozen assurance budget; denies undeclared agent launches | `test/assurance-dispatch.test.mjs`, `test/native/assurance-dispatch.test.mjs` | Task-record read; record write only when reserving |
| `hooks/te-host.cjs` | `PreToolUse` | keep | deny only when test-engineering is selected/required; fail-open otherwise | `te_test_write`: a test-file write without a TE method denies | `test/te-hook-contract.test.mjs`, `test/hook-resilience.test.mjs` | Capability resolve + evaluator against the real Git candidate state |
| `hooks/orchestrator-write-lock.cjs` | `PreToolUse` | keep | enforced for the explicitly bound task; ordinary writes allow | Specialist requirements/SEIT stay author-owned; frozen review/repair transitions | `test/orchestrator-write-lock.test.mjs`, `test/reviewer-repair-write-lock.test.mjs` | Plan/state read; deny JSON on violation |
| `hooks/com.anthropic.claude-code/host.cjs` | `Stop` | quiet-unless-gated | bound task only; second stop (`stop_hook_active`) and Cursor `loop_count` silent; never blocks or continues | Closeout advisory: `handoff_complete` / `handoff_incomplete` checklist; Cursor keeps it as `additional_context`, other wires omit it | `test/host-mapping.test.mjs`, `test/cursor-stop.test.mjs`, `test/hook-quiet.test.mjs` | Same bounded scan + closeout evaluator |
| `hooks/te-host.cjs` | `Stop` | keep | hard completion deny; allow prints `{}`; re-entry silent on every native host | `te_completion`: completion without a receipt denies exactly once | `test/te-hook-contract.test.mjs`, `test/hook-quiet.test.mjs` | Evaluator on stop only when TE is active |
| `hooks/git-sync.cjs` | `Stop` | quiet-unless-gated | bound task **and** actionable Git facts; silent when current, outside a checkout, or on re-entry | Fast-forward-only sync plus an attention list; never merges, rebases, pushes, or blocks | `test/git-sync.test.mjs`, `test/hook-quiet.test.mjs` | `git fetch` + rev ops, bound stops only, 10 s per command |
| `hooks/te-host.cjs` | `SubagentStop` | keep | hard child-stop deny; allow prints `{}`; re-entry silent | `te_completion` at child stop | `test/te-hook-contract.test.mjs` | Evaluator on child stop only when TE is active |

### `hooks/com.cursor/hooks.json` — Cursor

| Hook | Event | Mark | Gate / reason | Enforces | Test evidence | Cost |
|---|---|---|---|---|---|---|
| `hooks/com.anthropic.claude-code/host.cjs` | `sessionStart` | quiet-unless-gated | same binding gate as Claude `SessionStart` (no `--host=cursor` flag is needed: stop-only projection ignores session events) | Activation advisory, same as above | `test/task-opt-in.test.mjs`, `test/host-mapping.test.mjs` | Bounded Markdown scan, JSON stdout |
| `hooks/com.anthropic.claude-code/host.cjs` `--host=cursor` | `stop` | quiet-unless-gated | bound task only; `loop_count` ≥ 1 or `stop_hook_active` silent; advice is `additional_context`, never `followup_message` | Closeout advisory as context; `followup_message` only for `decision: "block"` | `test/cursor-stop.test.mjs`, `test/hook-quiet.test.mjs` | Bounded scan + closeout evaluator |
| `hooks/git-sync.cjs` `--host=cursor` | `stop` | quiet-unless-gated | bound task and actionable facts; `loop_count` ≥ 1 silent | Same advisory sync as Claude `Stop` via Cursor context | `test/git-sync.test.mjs`, `test/hook-quiet.test.mjs` | `git fetch` + rev ops, bound stops only |
| `hooks/assurance-dispatch.cjs` `--host=cursor` | `preToolUse` | keep | same barrier as Claude, Cursor `permission: deny` wire | Bound assurance reservation; denies undeclared launches | `test/assurance-dispatch.test.mjs` | Task-record read; wire JSON |
| `hooks/te-host.cjs` `--host=cursor` | `preToolUse` | keep | write-time deny only; fail-open otherwise | `te_test_write` on Cursor | `test/te-hook-contract.test.mjs` | Evaluator on writes when TE is active |
| `hooks/orchestrator-write-lock.cjs` `--host=cursor` | `preToolUse` | keep | bound-task write lock | Same specialist ownership as Claude | `test/orchestrator-write-lock.test.mjs` | Plan/state read |
| `hooks/assurance-dispatch.cjs` `--host=cursor` | `beforeShellExecution` | keep | same barrier for shell launches (a shell launch consumes once) | Bound launch inside a shell still counts against the budget | `test/assurance-dispatch.test.mjs` | Task-record read; wire JSON |
| `hooks/te-host.cjs` `--host=cursor` | `beforeShellExecution` | keep | same write-time deny for shell writes | `te_test_write` on shell writes | `test/te-hook-contract.test.mjs` | Evaluator on shell writes when TE is active |
| `hooks/orchestrator-write-lock.cjs` `--host=cursor` | `beforeShellExecution` | keep | same write lock for shell writes | Specialist ownership for shell writes | `test/orchestrator-write-lock.test.mjs` | Plan/state read |

Cursor registers no `te-host` stop hook (no hard completion deny there;
`te_completion` stays `UNAVAILABLE` on Cursor by the honesty table).

### `com.github.copilot/hooks/hooks.json` — GitHub Copilot

| Hook | Event | Mark | Gate / reason | Enforces | Test evidence | Cost |
|---|---|---|---|---|---|---|
| `hooks/com.anthropic.claude-code/host.cjs` | `SessionStart` | quiet-unless-gated | same binding gate (Copilot uses the shared adapter with no `--host` flag) | Activation advisory | `test/task-opt-in.test.mjs`, `test/host-mapping.test.mjs` | Bounded scan, JSON stdout |
| `hooks/assurance-dispatch.cjs` `--host=copilot` | `PreToolUse` | keep | bound barrier; `permissionDecision: deny` wire | Bound assurance reservation | `test/assurance-dispatch.test.mjs` | Task-record read |
| `hooks/te-host.cjs` `--host=copilot` | `PreToolUse` | keep | write-time deny when TE is active | `te_test_write` on Copilot | `test/te-hook-contract.test.mjs` | Evaluator on writes when TE is active |
| `hooks/com.anthropic.claude-code/host.cjs` | `Stop` | quiet-unless-gated | bound task only; `stop_hook_active` silent; advisory omitted on this wire | Closeout advisory (BLOCK-only closeout would be the sole continue) | `test/host-mapping.test.mjs`, `test/hook-quiet.test.mjs` | Bounded scan + evaluator |
| `hooks/te-host.cjs` `--host=copilot` | `Stop` | keep | `Stop` nested deny; re-entry silent | `te_completion` on Copilot | `test/te-hook-contract.test.mjs`, `test/hook-quiet.test.mjs` | Evaluator when TE is active |
| `hooks/te-host.cjs` `--host=copilot` | `SubagentStop` | keep | top-level deny; re-entry silent | Child-stop completion deny | `test/te-hook-contract.test.mjs` | Evaluator when TE is active |

Copilot registers no orchestrator write-lock and no git-sync; the
documented fallback is procedural plus `write_lock: absent` on
skill-copy. That is an absence, not a drop.

### `.kimi-plugin/plugin.json` — Kimi Code (legacy, unsupported)

| Hook | Event | Mark | Gate / reason | Enforces | Test evidence | Cost |
|---|---|---|---|---|---|---|
| `hooks/com.anthropic.claude-code/host.cjs` | `SessionStart` | keep | legacy-unsupported; same activation as Claude; no release smoke; removal is an owner decision | Activation advisory | Manifest pinned at 2 hooks (`test/plugin-manifest.test.mjs`); shared adapter tests | Bounded scan |
| `hooks/com.anthropic.claude-code/host.cjs` | `Stop` | quiet-unless-gated | legacy-unsupported; same closeout semantics as Claude (advisory omitted on this wire) | Closeout advisory | Shared adapter tests | Bounded scan + evaluator |

## Stop wire contract (all hosts)

- Stop `ADVISE`, `handoff_complete`, and `handoff_incomplete` are
  advisory context. They never request continuation: no host adapter
  emits `decision: "block"` or `followup_message` for them. The only
  stop continue request anywhere is a TE completion deny.
- Nothing-to-do is silent: unbound stops, a current git checkout, and
  anything outside a checkout all print an empty object (git-sync
  prints nothing at all).
- A second stop is silent: `stop_hook_active` on Claude Code, Codex,
  Grok Build, and Copilot; `loop_count` ≥ 1 on Cursor after a real
  follow-up.

This audit adds no new hook: manifests and registrations are unchanged.

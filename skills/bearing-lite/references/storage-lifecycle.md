# Storage lifecycle and landing

Follow the [landing order](task-state.md#landing-a-closed-unit). Finish the
change and focused checks, then push and open a draft PR for its number.
Commit the `CHANGELOG` link and number-dependent text. Gate once and push the
verified commit to the draft. If a push runs the gate, reuse its result for the
unchanged head with matching input hashes. After review closure, mark ready
and merge the same head with its exact-head receipt. A head change after gating
is a procedure defect. Verify delivery and resolve live references before
cleaning merged resources.

Run storage maintenance at intake/resume, wave boundaries, and closeout. Start
the Orchestrator in a directory that survives cleanup (outside leased task
worktrees) and name the worktree explicitly for short commands (for example
`git -C <worktree>`) so cleanup never finds the Orchestrator holding a worktree
open. Track
each task worktree, temporary build output, and evidence location with its owner,
size, and remove/retain/unresolved disposition. Verify current merge proof and
local contents, resolve live references, then remove released worktrees and
disposable outputs within existing authority. Preserve required evidence and
dirty or unmerged work. Report reclaimed space and named retention holds; a
merged PR alone does not complete storage closeout. Keep this bounded to assigned
paths, never a whole-workspace purge.

## Tooling (lifecycle-pool.mjs)

Routines, no daemon. Call `node <plugin root>/tools/lifecycle-pool.mjs`, where
`<plugin root>` is the absolute directory of the installed plugin (the folder
containing `tools/` and `plugin.json`). Never use a path relative to the
consumer checkout; the tool ships with the plugin, not the consumer project.
The Orchestrator calls it; agents register outputs but are not the sole cleanup
authority. Defaults: pool max 4 (concurrency bound), failed-diagnostic TTL 24h.

- `lease --pool P --repo R --owner O --branch B --worktree W --max N`: exclusive
  lease file `P/leases/<owner>.json` (pid, ts, branch, worktree); backpressure
  (`pool exhausted`) when active worktree leases hit max. Branch is created when
  missing and kept forever; only the worktree is removed later. Sequential
  slices should use `--branch-only` (branch without a worktree); allocate a
  worktree only when concurrency or filesystem isolation requires it.
- `release --pool P --owner O [--no-reclaim]`: mark released, then reclaim the
  worktree immediately when safe (clean, merged, unlocked). Refused reasons are
  reported in the result and the record stays released. Repeated lease/release
  cycles therefore leave no worktrees behind.
- `reclaim --pool P [--dry-run] [--max-total-mb N] [--priority largest|oldest|newest]`:
  removes released/stale worktrees whose actual checkout HEAD is merged into the
  repo HEAD, clean, unlocked and out of use. Refuses with the reason
  (locked/dirty/drift/unmerged/in-use); never `--force`. Stale means the recorded
  pid is dead; elapsed age alone never reclaims a live owner. Records are kept
  until safe reclamation succeeds. `--max-total-mb` (or `P/config.json` with
  `maxTotalBytes` and `priority`) bounds total worktree bytes and picks victims
  in priority order; others are reported as skipped.
- `clean-artifacts --pool P --root R --owner O [--status success|failed]
  [--extra a,b,c] [--registry file.json] [--evict-caches] [--dry-run]`: deletes
  only discovered or registered disposable outputs inside a root covered by the
  owner's lease (`target`, `__pycache__`, `.pytest_cache`, `.coverage`, `htmlcov`,
  `.ruff_cache`, `.mypy_cache`, `.hypothesis`, `CARGO_TARGET_DIR`, registered
  project outputs), including nested copies at any depth. The full plan is
  validated before any mutation and each path component is re-verified before
  each unlink. `--status failed` retains diagnostics newer than `--ttl-hours`.
  `node_modules`, venvs, similar-name user files and reusable caches
  (`incremental`/`deps` fingerprints, shared `CARGO_TARGET_DIR`) are preserved
  unless `--evict-caches` is given. Unleased roots are refused.
- `register --pool P --owner O --root R --path rel[,rel2]`: records project
  outputs for later cleanup under the same ownership and containment checks.
- `scan --pool P --repo R [--adopt] [--dry-run]`: inventories actual Git
  worktrees against leases (orphan, missing, dirty, merged, bytes). Read-only
  unless `--adopt`, which records orphan worktrees as released leases so
  `recover` can reclaim them during migration.
- `recover --pool P [--repo R] [--dry-run]`: runs safe reclamation and, with
  `--repo`, reconciles actual worktrees against leases. The Orchestrator runs
  it in finally, cancellation, and restart paths so cleanup is guaranteed.
- `status --pool P`: active count, per-lease bytes, total worktree bytes, total
  reclaimed so far. Audit: `P/audit.jsonl` per event (owner, action, bytes).

`--dry-run` prints every path that would be removed and deletes nothing.

Measurements, observed by test/lifecycle-pool.test.mjs on 2026-11-17: reclaim
frees exactly the worktree byte count; artifact cleanup frees exactly the
deleted bytes; re-checkout costs one worktree add (observed 43 ms). Defaults
are unchanged pending further measurement.

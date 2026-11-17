# Storage lifecycle and landing

Prefer coherent outcomes over tiny handoffs. Orchestration does not end at
worker handoff or a draft PR: verify delivery, then clean merged resources
after resolving live references.

Run storage maintenance at intake/resume, wave boundaries, and closeout. Track
each task worktree, temporary build output, and evidence location with its owner,
size, and remove/retain/unresolved disposition. Verify current merge proof and
local contents, resolve live references, then remove released worktrees and
disposable outputs within existing authority. Preserve required evidence and
dirty or unmerged work. Report reclaimed space and named retention holds; a
merged PR alone does not complete storage closeout. Keep this bounded to assigned
paths, never a whole-workspace purge.

## Tooling (tools/lifecycle-pool.mjs)

Routines, no daemon. The Orchestrator calls it; agents register outputs but
are not the sole cleanup authority. Defaults: pool max 4 (concurrency bound),
failed-diagnostic TTL 24h; both flags ride on every command.

- `lease --pool P --repo R --owner O --branch B --worktree W --max N`:
  exclusive lease file `P/leases/<owner>.json` (pid, ts, branch, worktree);
  backpressure (`pool exhausted`) when active leases hit max. Branch is
  created when missing and kept forever; only the worktree is removed later.
- `release --pool P --owner O`: mark released; the lease stays until reclaimed.
- `reclaim --pool P [--dry-run]`: removes released/stale worktrees whose branch
  is merged, clean, unlocked and out of use. Refuses with the reason
  (locked/dirty/unmerged/in-use); never `--force`. Stale = dead pid or ts
  older than 7d. Prunes missing entries.
- `clean-artifacts --pool P --root R --owner O [--status success|failed]
  [--extra a,b,c] [--dry-run]`: removes only exact disposable names
  (`target`, `__pycache__`, `.pytest_cache`, `.coverage`, `htmlcov`,
  `.ruff_cache`, `.mypy_cache`, `.hypothesis`, `CARGO_TARGET_DIR`, extras).
  `--status failed` retains diagnostics newer than `--ttl-hours`. Refuses
  symlink candidates; canonical containment per path. `node_modules`,
  venvs, shared caches and similar-name user files are never touched.
- `status --pool P`: active count, per-lease bytes, total reclaimed so far.
- Audit: `P/audit.jsonl` per event (owner, action, bytes); totals derive from it.

`--dry-run` prints every path that would be removed and deletes nothing.
Measure before tightening defaults: see test/lifecycle-pool.test.mjs fixtures.

---
name: set-bearings
description: >
  Create or resume the visible Journey workspace and bounded repository map
  after Repository Fit is confirmed. Use for Set Bearings or stale project
  context. Do not use before fit, for owner decisions, design, implementation,
  hidden state, or deleting historical plans.
---

# Set Bearings

Fresh planning node. The Router announces `Setting Our Bearings in <repo>.`

## Inputs and match

- **Inputs:** confirmed repository root, owner-confirmed plan directory, Journey
  title, visible existing artifacts, repository rules, and return schema.
- **Match:** the workspace or repository map is missing or stale.
- **Non-match:** both are current and usable by Gather Supplies or Map the Route.

## Algorithm

1. Re-read the exact confirmed root and plan directory; never derive a different
   root, slug, suffix, or sibling workspace.
2. If `workspace.md` exists in the plan directory, verify recorded root and plan
   directory match confirmed inputs; a mismatch returns `BLOCKED`. Run `git
   status --porcelain` scoped to mapped inputs; if unmodified, return
   `WORKSPACE_RESUMED` (1 read, 1 status).
3. Bound discovery: depth 2, max 40 paths, max 64 KiB, read-only. Anchors are
   root manifest, task runner, CI entrypoint, top-level instructions, and root
   test configs. Strictly prohibit discovery traversal into repo-relative
   `src/`, `lib/`, `vendor/`, and `docs/`.
4. If bounds are exhausted before required anchors are found, return
   `NEEDS_EVIDENCE` naming the missing anchor. Never compose unobserved commands.
5. Create missing plan directory or update `workspace.md` in place, preserving
   existing recorded evidence and unrelated edits. Initialize a missing file
   from `templates/workspace.md`. Quote validation commands with source and mark
   `[observed, not run]`. Drop detail before Constraints and Unknowns.
6. Verify written paths remain inside authority and return `WORKSPACE_READY`.

## Return and recovery

Return `WORKSPACE_READY`, `WORKSPACE_RESUMED`, `NEEDS_EVIDENCE`, or `BLOCKED`
with paths, map freshness, evidence, blocker, and next planning stage. Retry only
from corrected evidence, at most three attempts.

Never ask planning questions, write risk choices, design, implement, create
hidden runtime state, or delete plan content.

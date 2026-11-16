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

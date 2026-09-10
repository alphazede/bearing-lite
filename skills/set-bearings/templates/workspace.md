# Workspace Environment: <journey-topic>

## Repository Identity
- Root: `<repository-root>`
- Plan directory: `<plan-directory>`

## Mapped Inputs
- `<relative-path>`: `<what it establishes>`

## Observed Systems
- `<relative-directory>`: `<subsystem>`

## Constraints and Git Boundaries
- Branch / Worktree: `<branch>` (clean | dirty)
- Rules: `<applicable-rules>`

## Validation Commands [observed, not run]
- Test: `<command>` (source: `<anchor-file>`) [observed, not run]
- Lint: `<command>` (source: `<anchor-file>`) [observed, not run]
- Build: `<command>` (source: `<anchor-file>`) [observed, not run]

## Unknowns
- `<unknown or none observed>`

## Map Freshness
- Tier 1: Recorded root and plan directory match confirmed inputs.
- Tier 2: `git status --porcelain` scoped to mapped inputs shows no modifications.
- Note: Does not detect committed changes postdating this observation.

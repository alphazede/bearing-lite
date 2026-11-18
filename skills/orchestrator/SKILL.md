---
name: orchestrator
description: >
  Coordinate a Bearing lifecycle wave as Orchestrator only when the owner
  explicitly requests Bearing for that mode. Use for coordinating an approved
  multi-packet wave through its end boundary. Do not use for implementing one
  assigned packet, ordinary work, model or role selections, or advisory-hook
  suggestions.
---

# Orchestrator

Discoverable name for the single canonical orchestration owner. This skill
forwards to its canonical text; it does not duplicate orchestration policy.

Read and act as `../bearing-lite/SKILL.md` (Bearing Orchestrator). That file
is the one canonical owner of lifecycle sequencing, owner communication,
frozen profile dispatch, direct packets and implementation waves, and closeout.
All `references/` contracts it cites remain under `../bearing-lite/references/`.
Received duties D1 to D9 and D11 are in `../bearing-lite/references/coordinator-migration.md`; do not copy that table here.

## Match and non-match

- Match: owner explicitly requests Bearing orchestration, including
  coordinating an approved multi-packet wave through its end boundary. The
  Implementation Orchestrator owns new waves and follows the linked migration
  procedure for frozen legacy Coordinator assignments.
- Non-match: implementing one assigned bounded packet (use
  `../implementer/SKILL.md`), ordinary work, naming models or roles, or an
  advisory-hook suggestion. Stop here and route onward; do not orchestrate.

## Activation and review

Bearing activation is explicit opt-in. Unrequested review stays inactive: an
independent reviewer runs only when explicitly requested, at the requested
task, phase, or lifecycle boundary; author self-checks remain with authors.

## Return and stop

Return `READY`, `WAITING_ON`, `OWNER_DECISION_REQUIRED`, or `COMPLETE` with
mode, stage, candidate, completed work, evidence, blocker, and next action.
Missing authority or evidence is a typed gap (`WAITING_ON` or
`OWNER_DECISION_REQUIRED`), never permission. Stop on any genuine authority
or material-intent stop instead of inventing decisions.

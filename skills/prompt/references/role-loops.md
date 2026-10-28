---
type: agent-reference
title: Agent Role and Session Loop Index
tags: [bearing, handoff]
---

# Role and session loops

Select one row for one authorized assignment. The linked role skill is canonical;
this index summarizes its sequence and never grants another role or invocation.
If a row and its skill disagree, return the conflict before composing a packet.
Every author checks and repairs its own deliverable inside the current assignment.
An evaluator checks its report, not the candidate it is evaluating. Additional
invocations and role transitions require their existing explicit authority.

| Selected role/session | Loop | Canonical skill |
| --- | --- | --- |
| Planning Orchestrator | Confirm context/scope → dispatch enabled, needed specialists as their inputs become ready → wait/wake on responses → final plan/design and self-check → assembly validating allocations, case bindings, and coverage → requested planning review (else record not requested) → owner confirmation → Scribe-coverage handoff check → handoff | [Orchestrator](../../bearing-lite/SKILL.md) |
| Implementation Orchestrator | Consume handoff → select ready work → dispatch enabled roles → wait/wake on responses → integrate and verify → requested review → deliver | [Orchestrator](../../bearing-lite/SKILL.md) |
| Coordinator | Consume approved wave → dispatch ready independent assignments → wait/wake on returns → integrate evidence → run wave checks → return | [Coordinator](../../coordinator/SKILL.md) |
| Requirements Engineer | Author requirements from confirmed Alignment/Scope context → self requirements-quality pass and `--stage requirements` precheck → repair own requirements → recheck → return quality evidence with owned pending bindings | [Requirements Engineer](../../requirements-engineer/SKILL.md) |
| Systems Modeler | Consume requirements/context → model and map → self-check → repair own models/views → recheck → return | [Systems Modeler](../../systems-modeler/SKILL.md) |
| Integration Engineer planning | Consume requirements/architecture/interfaces → define boundary and assembly inputs → self-check → repair own contract/strategy → return | [Integration Engineer](../../integration-engineer/SKILL.md) |
| Planning Test Engineer | Consume requirements and interface/boundary inputs → choose methods → author SEIT/proof cases bound to existing requirement IDs → self-check → repair plan → return | [Test Engineer](../../test-engineer/SKILL.md) |
| Test Implementer | Consume behavior contract → author tests/fixtures → check test validity → prove expected baseline failure → repair test defects in scope → recheck → return | [Implementer](../../implementer/SKILL.md) |
| Product Implementer | Consume tests/contract → implement → run checks → inspect evidence → repair own defects → recheck → return | [Implementer](../../implementer/SKILL.md) |
| Combined Implementer | Establish regression evidence → author tests and product → check both → repair in scope → recheck → return | [Implementer](../../implementer/SKILL.md) |
| Light Implementer | Execute the exact mechanical packet → run its deterministic command → return evidence or typed failure without a repair loop | [Light Implementer](../../light-implementer/SKILL.md) |
| Reviewer | Bind exact wave/PR → own OCR preflight and start bug/security review → concurrently assess architecture, requirements, implementation/V&V and quality evidence → validate/deduplicate all findings → freeze receipt → use advance-authorized same-session Repair Implementer → deterministic checks → return one consolidated result; no controller acceptance round-trip, extra review or budget reset | [Reviewer](../../reviewer/SKILL.md) |
| Assurance Test Engineer | Bind exact independent candidate → execute planned V&V methods → evaluate proof → check report → return evidence and gaps without candidate mutation | [Test Engineer](../../test-engineer/SKILL.md) |
| Integration Engineer execution | Bind integrated candidate/outcome → run system-level checks → assess compatibility and evidence → check report → return without product repair | [Integration Engineer](../../integration-engineer/SKILL.md) |
| Scribe | Consume source-backed event scope → transcribe → check coverage → repair own transcription → recheck → return; event streams stay in the same invocation | [Scribe](../../scribe/SKILL.md) |

## Controller procedures and explicit helpers

These are not additional dispatched specialist roles:

- [Intake](../../intake/SKILL.md): establish repository identity and plan location;
  reuse confirmed inputs and return actual ambiguity to the owner.
- [Architectural Alignment and Scope](../../architectural-alignment/SKILL.md):
  establish source-backed fit, resolve material decisions, and record shared scope.
- [Scope Definition](../../scope-definition/SKILL.md): compatibility forwarding to
  the same combined procedure; no second stage or agent.
- [Final Planning and Design](../../planning-and-design/SKILL.md): the Planning
  Orchestrator synthesizes specialist inputs, checks/repairs its own final artifacts,
  assembles, runs requested review, obtains confirmation, and writes the handoff.
- [Profile configuration](../../onboard-bearing/SKILL.md): only on explicit request,
  obtain choices, validate the proposed change, save authorized fields, and read back.
- [Prompt composition](../SKILL.md): choose the already selected session's row and
  return its bounded packet; never dispatch itself or another agent.
- [Storage lifecycle and landing](../../bearing-lite/references/storage-lifecycle.md):
  land coherent outcomes and maintain worktree, output, and evidence storage.
- [Wave operations](../../coordinator/references/wave-operations.md): keep the
  wave task graph, name method skills in packets, and hand storage to the Orchestrator.

## Conditions that remain with the caller

Specialists are optional and must be enabled in the frozen selected profile and
needed by the task. Review/independent evaluation also needs the owner's requested
scope/cadence. Missing prerequisites return typed gaps; an inactive role is never
a reason to invent another role or take over its authorship. Use actual dependency
edges to parallelize ready work. Test implementation follows planning/handoff;
TDD orders Test Implementer before Product Implementer. No loop authorizes polling,
automatic fan-out, a fixed attempt count, or an extra invocation.

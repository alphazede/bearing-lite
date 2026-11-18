---
name: systems-modeler
description: >
  Select modeling mode and attach view metadata in the planning wave before
  design finalization. Use for Systems Modeler planning session. Do not
  model execution waves or author requirements.
---

# Systems Modeler

One profile-enabled planning assignment, dispatched once with its actual inputs.
Loop: consume requirements/context → model and map → self-check → repair own
models/views → recheck → return. Final Orchestrator design follows these inputs.

## Inputs and match

- **Inputs:** requirements, architecture, existing contracts, view need, method capability, source bindings, and authorized output paths.
- **Activation:** a contract state machine, protocol sequence, or interaction needing
  formal modeling binds a `model` here; otherwise it records `model_na_reason`.
- **Match:** engineering views or SysML mode selection is required.
- **Non-match:** requirement authorship, V&V, implementation.

## Algorithm

1. Select `sysml-v2`, `diagram-assisted`, or `not-applicable`. Attach
   view metadata. In `sysml-v2`, record model revision/digest and native
   or derived views. For a state-machine model, write each rule the owner
   accepts as a named invariant and label states and transitions in the
   reader's words. Keep a view readable at a glance; merge only states that
   behave alike and break no different rule, and list hidden transitions in
   the view's omissions.
2. Map current flow, candidate placements with `file:line`, constraints, and
   requirement relationships; return them as the placement receipt that final
   Planning and Design allocates against. Self-check model quality, source identities,
   mappings, constraints, and coverage; repair your own views and recheck in-run.
   Do not require a later integration plan or final design unconditionally;
   report genuine missing inputs instead of creating a circular stage or new pass.
3. Do not silently substitute Mermaid for mandated SysML. Missing SysML
   Modeling skill is a typed capability gap, not invented behavior.
4. Supply each model as one `dod_manifest.models[]` entry the Orchestrator
   copies unchanged. `id` is required. An activated model (`selected` or
   `required`, and not not-applicable) also sets `digest` (`sha256:` plus the
   hex of the view bytes) and `view`, or `views[0]` when `view` is absent:
   `format` `svg` or `png` with `path` relative to `implementation.json`, or
   `format` `svg` with `inline`. Set `mode`, `source`, `revision`, `viewpoint`
   (the question the owner is judging), `trace`, `limitations`, `render_status`,
   and view `alt`. Inactive (`selected` false and `required` false) or
   not-applicable gives `reason` and no view.
5. Close every finding. Fix it in your own models, or name its owner (a role
   or an artifact) and a proposed fix. A finding that only restates a problem
   is incomplete.
6. Write for the owner who reads the views in the DoD Manifest. Plain English,
   one claim per sentence. Cite `path:line` or a requirement ID. Do not restate
   the source. Keep only what the owner needs to judge the view. Overlap among
   systems engineering, test, and MBSE stays.

## Return and recovery

Return `READY` or `OWNER_DECISION_REQUIRED` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.
Findings carry an id, an owner, a proposed fix or `closed`, and a source citation.

Never invent SysML coverage or claim local normative authority without a pin.

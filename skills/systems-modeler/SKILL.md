---
name: systems-modeler
description: >
  Select modeling mode and attach view metadata after Requirements
  Engineer work and before design finalization. Use for Systems Modeler
  planning session. Do not finalize requirement mappings against unstable
  requirements.
---

# Systems Modeler

One role with a planning session. Runs after the Requirements Engineer and
before design finalization. When selected or required, it also runs a
contextual pass before or alongside Planning and Design pass 1.

## Inputs and match

- **Inputs:** requirements, view need, modeling-mode metadata.
- **Match:** engineering views or SysML mode selection is required.
- **Non-match:** requirement authorship, V&V, implementation.

## Algorithm

1. Select `sysml-v2`, `diagram-assisted`, or `not-applicable`. Attach
   view metadata. In `sysml-v2`, record model revision/digest and native
   or derived views.
2. Run the contextual pass first when selected or required: current flow,
   candidate placements with `file:line`, and constraints. Contextual work
   may start before requirements stabilize. Do not finalize requirement
   relationship mappings until the Requirements Engineer passes.
3. Do not silently substitute Mermaid for mandated SysML. Missing SysML
   Modeling skill is a typed capability gap, not invented behavior.

## Return and recovery

Return `READY` or `OWNER_DECISION_REQUIRED` with verdict,
candidate_ref, changed_paths, tests, findings, and blocker.

Never invent SysML coverage or claim local normative authority without a pin.

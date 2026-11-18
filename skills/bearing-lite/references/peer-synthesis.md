# Peer synthesis evidence

Bearing keeps its own skills-first identity, visible Markdown state, authority
ladder, and assurance separation. The catalog synthesizes behavior; it does not
copy peer text, runtimes, state stores, or authority assumptions.

| Bearing skill | Strongest compared peer | Behavior retained |
| --- | --- | --- |
| Bearing Orchestrator | [LangChain subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents) and [handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs) | central conversational supervisor, bounded handoff, fresh context |
| Orchestrator (`skills/orchestrator/`) | `bearing-lite` (internal alias) | discoverable name only; forwards to `../bearing-lite/SKILL.md`, which stays the one canonical owner — no policy copy, no new role |
| Coordinator (vs Orchestrator) | `bearing-lite` (internal boundary) | Coordinator owns one approved execution wave; Orchestrator owns lifecycle, sequencing, and planning dispatch — neither duplicates the other |
| Intake | [Kiro steering](https://kiro.dev/docs/steering/) | verified workspace and explicit global/workspace scope |
| Architectural Alignment | [Kiro steering](https://kiro.dev/docs/steering/) | durable human-readable workspace context |
| Architectural Alignment — scope interview | [Matt Pocock grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) | dependency-ordered owner decisions grounded in repository facts; Bearing retains one question at a time |
| Planning and Design | [Kiro Quick Spec](https://kiro.dev/docs/specs/quick-spec/) and [GitHub Spec Kit](https://github.com/github/spec-kit/blob/main/workflows/speckit/workflow.yml) | technical-plan, design.md, seit.json, implementation.json, DoD Manifest |
| Coordinator | LangChain subagents | bounded worker dispatch, proven-independent lane coordination, and result integration |
| Implementer | Spec Kit implement step | bounded execution after approved planning; split Test Implementer versus Product Implementer |
| Scribe | event side lane | transcribes; cannot activate authority |
| Planning Orchestrator | Spec Kit tasks gate | reconciles five artifacts; generates implementation.json and DoD Manifest input |
| MBSE | MBSE requirements and view selection | authors requirements, self-checks, selects modeling mode, and returns placement evidence |
| Integration and Test | Spec Kit gate and assembly planning | planning session authoring Boundary/Data-Flow Contract, assembly strategy, and `seit.json` |
| Integration Engineer | assembly execution | execution session assessing the integrated candidate; replaces Surveyor |
| Test Engineer | Spec Kit gate | Assurance session (`test_engineer.sessions.assurance`); Validator absent from active roles |
| Reviewer | LangChain reviewer subagent | independent defect review with a typed return |
| onboard-bearing | first-run setup | explicit one-setting-at-a-time profile writes; no credentials |

## #214 gap: explicit Orchestrator name

- Gap was discoverability only: `skills/bearing-lite/SKILL.md` is already
  titled "Bearing Orchestrator" and owns lifecycle sequencing, owner
  conversation, frozen profile dispatch, and closeout; no directory named
  `orchestrator` existed, so hosts surfaced no `orchestrator` skill name.
- `skills/coordinator/` owns one approved execution wave and must not own
  lifecycle or planning dispatch; it is an adjacent peer, not the gap filler.
- Chosen direction: `skills/orchestrator/SKILL.md` forwards to
  `../bearing-lite/SKILL.md` as the one canonical behavior owner. The reverse
  (moving canonical text into `orchestrator`) would relocate 13 references
  and break established contract tests for no behavior gain, and would risk a
  second policy copy, which this issue forbids.
- Registration is directory-based: every shipped host manifest points at
  `./skills/` and `package.json` `files` includes `skills/`, so the new
  directory ships and is discovered with no manifest edit.
- Review follows the amended owner rule: unrequested review stays inactive;
  an independent reviewer runs only when explicitly requested at the chosen
  task, phase, or lifecycle boundary. The canonical owner already states
  this; the alias restates it without adding a review loop or budget.

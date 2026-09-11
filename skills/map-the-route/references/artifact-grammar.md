# Map the Route Artifact Grammar

Apply this closed grammar while authoring or validating planning artifacts.
Bearing rejects deviations with typed findings.

The canonical Journey planning artifacts are exactly
`<journey-topic>-technical-plan.md` with `type: technical-plan`, `design.md`,
`seit.json`, `implementation.json`, and `review.html`. Markdown carries
technical-plan and design reasoning; the JSON files are schema-validated
machine authorities; `review.html` is their complete integrated human
projection. There is no sixth canonical planning artifact. XLSX may be an
optional derived export and is never authority.

## Shared artifact rules

1. Frontmatter declares `type` as `technical-plan` or `design`, and `status` as
   `complete` or `amended`.
2. Journey-authored requirement IDs use `AC-*` or `RISK-*`; references to an
   existing requirements register keep that register's identities verbatim.
   Design IDs use `DES-*` or `CONTRACT-*`; SEIT rows use `SEIT-*`; commands
   use `CMD-*` or `PROC-*`. Suffixes contain only uppercase letters, digits,
   dots, or hyphens.
3. `<journey-topic>-technical-plan.md` declares requirements, Entry criteria,
   Exit criteria, Rollback or repair, and Accountable controller. `design.md`
   declares design IDs. `seit.json` declares SEIT rows and commands.
4. Preserve stable IDs. Every implementation reference resolves to a declared
   requirement, design contract, SEIT row, and command.
5. Owner-supplied lineup identities and proposed `review_cadence: at-end` are
   required before implementation drafting; missing identities or cadence block
   drafting. Do not offer `per-slice` or `per-round`. Map the proposed Journey
   type and active/standby/unused role states before generating implementation;
   the final implementation and `review.html` record those proposals together.
6. The lineup snapshot contains the Journey-owned `planning_review` binding:
   policy reference, one candidate ref/revision/digest, and unique abstract
   reviewer slots with a primary route reference plus ordered fallback route
   references. Slot count satisfies the referenced core policy. Do not put route
   identities in the core policy or map these slots to implementation assurance.

## Requirements register

1. Before authoring a Journey specification, establish whether the target
   repository or system already has a requirements register and where. When the
   repository cannot answer, ask the owner; never infer.
2. Where no register exists, author requirements as today; this section does not
   apply.
3. Where a register exists, specification requirement rows are either references
   to registered identities (no restated text), derivations from them
   (`AC-X derives from REG-ID`), or Journey-local `AC-*`/`RISK-*` criteria about
   write sets, seams, gates, or concurrency. Do not restate registered content.
4. `seit.json` references verification allocations where the register provides
   them. Where the register provides none for a referenced requirement, author
   Journey-level proof for it or return `NEEDS_OWNER_DECISION` when register
   authority is unclear; do not silently drop coverage. Journey-level proof
   rows remain Journey-local.
5. `review.html` marks every requirement as either a register reference or
   Journey-local, so a reviewer can tell which artifact owns each statement.
6. `design.md` is unaffected: it records how the work is built, which no
   requirements register covers.
7. A specification-authoring Journey carries its requirement register (UID,
   statement, rationale, verification method, allocation) as a planning
   artifact: a draft `.sdoc` path (Markdown sections are not lint-checkable),
   recorded as `implementation.json` `journey_settings.journey_type:
   specification` plus `journey_settings.requirement_register`. The freeze
   fails without an existing register; the Requirements Engineer gates it
   before the integrated owner review; no Expedition wave re-gates it.

## Published standards

1. When a slice, command, or proof implements a published standard, the plan and
   its execution manifest cite the exact document and clause.
2. Verification is against the standard's text, not against neighbouring
   implementation agreement; a passing cross-boundary test does not substitute
   for clause conformance.

## SEIT rules

1. `seit.json` is the canonical JSON Schema-validated tailored V&V plan.
   Always-on sections: scope/baseline; responsibility/change authority;
   applicable documents/precedence; requirements flowdown/architecture context;
   V&V methods; verification and validation matrices; levels/integration
   sequence; environments/fixtures/data/simulations/support;
   procedures/commands; evidence/pass-fail; anomaly/corrective/closure.
   System fields only where applicable.
2. Include non-empty `Required Commands`, `Traceability Matrix`, and
   `Cross-cutting Checks` sections or JSON equivalents.
3. Declare each command with a `CMD-*` or `PROC-*` id and description.
4. Use one flat traceability table with exactly these columns: SEIT row ID |
   Acceptance/risk ID | Design/contract ID | Boundary/test layer | Positive
   case | Negative/failure case | Command/procedure ID | Evidence.
5. Every row carries exactly one SEIT row ID, requirement ID, design ID, and
   command ID, and names an observable failure.
6. Bind a stable decision-baseline projection of confirmed decision identities
   and open-item statuses rather than the whole-file `journey.json` digest.

## Implementation rules

1. Regular JSON is the nested execution authority for Journey settings, lineup
   snapshots, waves, slices, dependencies, traceability, and manifests.
2. Every slice declares one named role plus goal, type, requirement IDs, design
   IDs, SEIT proof rows, exact design-lens names sourced from `design.md`,
   owner-selected model route, reasoning, review path, write set, command IDs,
   stop condition, human decision, and `authority_id`. Goals are at most 512
   characters. Slice actions and write sets are subsets of current authority.
3. Optional fields are Shared interfaces (`path#Symbol`), Integration
   boundary, Published standard (`doc#clause`) when applicable, SysML and
   integration fields when selected, and Parallel safe (`yes` or `no` plus
   reason).
4. Write sets use one line: `Write only `path``. Paths are bounded, normalized,
   repository-relative literals. Put prohibitions in prose, not the write set.
5. Multi-slice plans declare consecutive `Wave <n>: <ids>` lines. Every slice
   belongs to one wave. Dependencies use acyclic `S1 --> S2` arrows.
6. Ordered integration steps, resources, ownership, and rollback live here.
   Owner-configured reviewer count `n`, repair bound `k`, and confirmation
   count `c` are explicit fields with no assistant default integers.
7. Plans may contain at most 128 slices, manifests, write paths, and commands.
   Aim for at most 500 estimated tokens per slice plus manifest; split larger
   packets when practical.

## Optional binding sections

If `## System Catalog` appears, use System ID | System | Responsibility with
one `SYS-*` per row. Each `### SYS-*` specification declares Ownership, Inputs,
Outputs, APIs, Data ownership, Invariants, Trust boundary, Failure modes, and
Observability. A Requirement Trace, when present, maps Requirement ID, System
ID, Contract ID, SEIT row ID, Slice ID, and Path; every requirement and path
must resolve.

If `## Risk Profile` appears, enumerate the complete closed flag set required
by Bearing. Every `yes` maps design or system, SEIT row, and slice coverage.
Every `no` gives an evidence-backed rationale of at least four words; do not use
placeholders, bare negations, or deferral language.

## Feature diagram and visual review rules

1. Select review-oriented feature diagrams (flow diagrams, state-machine diagrams, or process/sequence diagrams) when they materially clarify architecture or lifecycle behavior for owner review.
2. Major features select a justified subset or full set of diagrams based on architectural complexity. Trivial features or minor fixes do not require unnecessary diagrams.
3. Every feature diagram must include canonical, reviewable source (such as Mermaid code blocks), render visually inside generated `review.html`, and retain nearby authoritative explanatory text.
4. Non-trivial technical plans include words plus context/boundary, use-case/outcome, and operational-flow views. In MBSE mode record model revision/digest; never silently substitute Mermaid for mandated SysML. Trivial work may record `diagram_not_required` with a concrete rationale.

## Completion boundary

Author technical-plan, design, SEIT, implementation, and review HTML in that
dependency order with internal prospective checks; generate implementation and
HTML together after their stable inputs. `review.html` has two states:
`planning-review` before implementation and `final-closeout` after
implementation. Each records its stage and exact input digests. The single owner review gate requires
the complete five-artifact package. Do not insert a lineup, route, or
specification-only owner gate unless the owner explicitly requests staged
approvals. The HTML becomes authoritative only after integrated owner approval.

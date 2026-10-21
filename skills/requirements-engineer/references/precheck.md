# Register pre-check

The Requirements Engineer runs this mechanical check during its own authoring
assignment on the candidate register and available context. It complements the
semantic self requirements-quality pass; it does not introduce a separate checker.

```sh
node hooks/register-precheck.cjs --stage requirements <draft.sdoc> <workspace.md> <repository-root>
```

## Stages

- `--stage requirements` (Requirements Engineer): the context input is the
  confirmed Alignment/Scope `workspace.md` with its recorded `DEC-*` decisions
  and quantity-definitions table. A row with a verification method but no case ID
  is reported in `pending_bindings` with `owner: test_engineer` and
  `blocks: final_assembly`; it is not a finding and never an invented ID. Every
  other class (method, EARS, glossary, reference, decision, citation) still fails.
- `final` (the default; Planning Orchestrator during assembly, after the Test
  Engineer bound cases to existing requirement IDs): the context input is the
  final technical plan. Every row needs a case ID; add `--seit <seit.json>` to
  require each ID to resolve to a SEIT `proof_cases[].id`. Pending bindings fail.
  Final `plan-package.cjs` freeze enforces this directly whenever a register is
  declared in journey settings or authority. The bound planning inputs must
  identify exactly one `*-technical-plan.md` (or compatibility `plan.md`);
  missing/ambiguous context and unreadable register, SEIT, or citations fail closed.
  Draft freeze does not require completed final case bindings.

Never fabricate a preliminary technical plan to satisfy this command. Missing
required context is a typed gap.
Exit 0 / `outcome: PASS` is a clean mechanical receipt; exit 1 carries findings
for the author to repair and recheck in-run, and exit 2 is invalid invocation.
Bind receipts to the actual candidate, stage, and unchanged input bytes. Rerun
affected checks after a register, context, SEIT, or cited source changes. A
path-only receipt is not proof of freshness. Preserve stdout, source identities,
and actual lint evidence; do not invent receipt digests or imply the CLI ran an
external linter. The exported `checkRegister` is pure and accepts `stage` and
`seitCaseIds`.

## Bounded input grammar

This is a mechanical subset of StrictDoc, not a full syntax validator.
Use `[REQUIREMENT]` blocks with `UID`, `STATEMENT`, `RATIONALE`,
`VERIFICATION_METHOD`, `VERIFICATION_CASE` (or `VERIFICATION_CASES`,
`VERIFICATION_CASE_ID`, `VERIFICATION`), and decision traces anywhere in the
row. Multiline fields use `>>>` / `<<<`. Relation `VALUE`, `UID_REF`,
`DEFINITION_REF`, and `REFERENCES` resolve against register UIDs or plan
`DEF-*` / `GLOSS-*` declarations. Inline references use `[[UID]]`, `UID: ID`,
`DEFINITION: ID`, or `DEF: ID`; `DEF-*` / `GLOSS-*` tokens also resolve.

Record `DEC-*`, `DEF-*`, and `GLOSS-*` declarations in context headings or the
first table cell. A mention alone is not a declaration. At the requirements
stage the workspace's `### Quantity definitions` table is the glossary; at final
assembly the Planning Orchestrator copies that same table into the plan's
`## Glossary` without redefining it. Its first column is the defined name (a
definition-ID first column may use the second column for the name). Mark used domain terms in statement/rationale with backticks
or `TERM: name`; plain prose cannot deterministically distinguish domain
terms from ordinary words. Reserve backticks there for glossary terms,
identities, and citations. References and citations in the plan are checked too.

## Receipt classes

Each finding has `class`, `uid`, `location` (`path:line`), and `message`.
Locations identify field starts; document findings use `<register>` or `<plan>`.

- `verification`: missing method (test, inspection, analysis, demonstration,
  evaluation) or, at the final stage, a missing case ID (`SEIT-*`, `VC-*`,
  `CASE-*`, `TEST-*`) or one absent from the supplied SEIT.
- `ears`: missing keyword, case-insensitive When, While, Where, shall, or
  If ... then. The repository supplies no keyword list; these standard EARS
  patterns check presence only, leaving correctness to semantic review.
- `glossary`: explicitly used domain term absent from the glossary table.
- `reference`: unresolved UID/definition reference or missing register rows/UID.
- `decision`: row has no trace to a recorded plan decision.
- `citation`: repository-relative `file.ext:line` names a missing file,
  line zero, or a line beyond EOF. A final newline is not an extra line.

The Requirements Engineer inspects the candidate-bound receipt as part of its
own self-quality pass, fixes applicable findings, and checks semantic concerns
that the mechanical checker cannot decide. Workspace `lint-sdoc.py --profile
library` evidence remains separate; this plugin neither requires that executable
universally nor shells out to it. Missing required workspace lint is a typed gap.

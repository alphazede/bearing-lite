# Register pre-check

Before every Requirements Engineer dispatch, including corrected candidates, run:

```sh
node hooks/register-precheck.cjs <draft.sdoc> <technical-plan.md> <repository-root>
```

Exit 0 and `outcome: PASS` are both required. Exit 1 blocks dispatch; exit 2
is invalid invocation. Return findings to Planning and Design without spending
any Requirements Engineer correction round. Missing inputs fail closed.
Attach stdout to the dispatch packet and name the unchanged register and plan
candidate revision. Rerun after either input or any cited file changes; a
path-only receipt is not proof of unchanged content. Do not copy register
digests into receipts. The exported `checkRegister` is pure: supply register,
technicalPlan, their display paths, and a map of repository-relative cited
file paths to text. The CLI reads local files only; it never executes a linter.

## Bounded input grammar

This is a mechanical subset of StrictDoc, not a full syntax validator.
Use `[REQUIREMENT]` blocks with `UID`, `STATEMENT`, `RATIONALE`,
`VERIFICATION_METHOD`, `VERIFICATION_CASE` (or `VERIFICATION_CASES`,
`VERIFICATION_CASE_ID`, `VERIFICATION`), and decision traces anywhere in the
row. Multiline fields use `>>>` / `<<<`. Relation `VALUE`, `UID_REF`,
`DEFINITION_REF`, and `REFERENCES` resolve against register UIDs or plan
`DEF-*` / `GLOSS-*` declarations. Inline references use `[[UID]]`, `UID: ID`,
`DEFINITION: ID`, or `DEF: ID`; `DEF-*` / `GLOSS-*` tokens also resolve.

Record `DEC-*`, `DEF-*`, and `GLOSS-*` declarations in plan headings or the
first table cell. A mention alone is not a declaration. Copy the Scope
Definition quantity-definitions table into `## Glossary`; its first column
is the defined name (a definition-ID first column may use the second column
for the name). Mark used domain terms in statement/rationale with backticks
or `TERM: name`; plain prose cannot deterministically distinguish domain
terms from ordinary words. Reserve backticks there for glossary terms,
identities, and citations. References and citations in the plan are checked too.

## Receipt classes

Each finding has `class`, `uid`, `location` (`path:line`), and `message`.
Locations identify field starts; document findings use `<register>` or `<plan>`.

- `verification`: missing method (test, inspection, analysis, demonstration,
  evaluation) or case ID (`SEIT-*`, `VC-*`, `CASE-*`, `TEST-*`). This checks
  binding presence, not case existence in a separate SEIT artifact.
- `ears`: missing keyword, case-insensitive When, While, Where, shall, or
  If ... then. The repository supplies no keyword list; these standard EARS
  patterns check presence only, leaving correctness to semantic review.
- `glossary`: explicitly used domain term absent from the glossary table.
- `reference`: unresolved UID/definition reference or missing register rows/UID.
- `decision`: row has no trace to a recorded plan decision.
- `citation`: repository-relative `file.ext:line` names a missing file,
  line zero, or a line beyond EOF. A final newline is not an extra line.

The Requirements Engineer consumes a passing receipt and never re-reports
these covered mechanical classes. Judge semantics and uncovered checks.
Workspace `lint-sdoc.py --profile library` output remains a separate input;
this self-contained plugin check neither requires nor shells out to it.

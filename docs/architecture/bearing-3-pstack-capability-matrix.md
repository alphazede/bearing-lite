# Bearing 3.0 Pstack capability matrix

All 58 Pstack skills at `cursor/plugins` commit `e1cc03121a0e71129a4fb730d7c5528a0a3e43c8` are classified. The supply-chain scan is PASS. This file copies no Pstack sentence and no advisor sentence. Owner overrides in the approved matrix replace an earlier retain. `replace` is allowed and unused.

Observed 2026-11-17.

## Census and rules

Population, fixed before the rows were written: the 58 directories under `pstack/skills` at that commit. The directory names match the approved skill list. There is no second population. These SEIT rows are inspections, so this slice runs no experiment.

Status is one of implemented, partial, missing, or conflicting. Decision is one of retain, add, strengthen, merge, replace, hybridize, or reject.

CHECK-B30-402: every overlap row has exactly one of retain, add, strengthen, merge, replace, hybridize, or reject.

## Counts

Status: implemented 23, partial 18, missing 8, conflicting 9.
Decision: retain 18, reject 11, strengthen 14, hybridize 8, merge 5, add 2, replace 0.

## Capability matrix

| Skill | Status | Decision |
| --- | --- | --- |
| architect | implemented | retain |
| arena | conflicting | reject |
| automate-me | missing | reject |
| benchmark-checklist | missing | add |
| blast-radius | partial | hybridize |
| bro | implemented | retain |
| correct | conflicting | hybridize |
| create-formal-verification-skill | partial | strengthen |
| create-verification-skill | partial | strengthen |
| figure-it-out | implemented | retain |
| how | implemented | retain |
| in-your-own-words | partial | strengthen |
| interrogate | partial | merge |
| ketchup | partial | strengthen |
| ketchup-video | missing | reject |
| maintain-formal-verification-skill | partial | strengthen |
| maintain-verification-skill | conflicting | hybridize |
| make-bot-ui | missing | reject |
| no-comments | conflicting | reject |
| poteto-help | missing | reject |
| poteto-mode | conflicting | reject |
| principle-attack-the-premise | partial | strengthen |
| principle-boundary-discipline | partial | merge |
| principle-build-the-lever | implemented | retain |
| principle-encode-lessons-in-structure | partial | merge |
| principle-exhaust-the-design-space | implemented | retain |
| principle-experience-first | conflicting | reject |
| principle-explain-the-number | missing | merge |
| principle-fix-root-causes | partial | strengthen |
| principle-foundational-thinking | implemented | retain |
| principle-guard-the-context-window | implemented | retain |
| principle-laziness-protocol | partial | strengthen |
| principle-make-operations-idempotent | partial | merge |
| principle-migrate-callers-then-delete-legacy-apis | conflicting | reject |
| principle-minimize-reader-load | implemented | retain |
| principle-model-the-domain | partial | strengthen |
| principle-never-block-on-the-human | implemented | retain |
| principle-outcome-oriented-execution | implemented | retain |
| principle-prove-it-works | implemented | strengthen |
| principle-redesign-from-first-principles | implemented | strengthen |
| principle-separate-before-serializing-shared-state | implemented | retain |
| principle-sequence-verifiable-units | implemented | retain |
| principle-subtract-before-you-add | partial | strengthen |
| principle-test-behavior-not-implementation | partial | strengthen |
| principle-type-system-discipline | missing | add |
| recall | implemented | retain |
| reflect | missing | hybridize |
| setup-pstack | implemented | retain |
| sharpen | partial | hybridize |
| show-me-your-work | implemented | retain |
| statechart | partial | strengthen |
| swarm | conflicting | reject |
| tdd | implemented | hybridize |
| teach | implemented | retain |
| technical-writing | implemented | hybridize |
| typescript-best-practices | conflicting | reject |
| unslop | implemented | hybridize |
| why | implemented | retain |

## Size limits

The binding public cap is `test/skills-conformance.test.mjs:372-376`: 60 lines and 650 words. `prompt` is exempt at line 35. This slice changes no `SKILL.md`. The only public `SKILL.md` a later update grows is `skills/systems-modeler/SKILL.md`, measured at 42 lines and 262 words, which remains under the cap after the planned two sentences.

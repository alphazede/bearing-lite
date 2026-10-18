---
type: agent-reference
title: Final Decision Batch
tags: [bearing, planning]
---

# Final Decision Batch

The final batch carries every confirmed decision plus the definitions those
decisions depend on. Record it in `workspace.md` (`templates/workspace.md`):
each decision as a `DEC-*` row and the quantity-definitions table under
`### Quantity definitions`. The Requirements Engineer uses that section as its
precheck context; final Planning and Design copies the table into the plan's
`## Glossary`; neither redefines it.

## Quantity-definitions table

For every numeric quantity a decision cites, one row with name, formula,
population and denominator (including how ties, pushes, or voids are treated),
units, and source field or contract. Example row: `tier_probability` |
wins divided by decided outcomes | decided outcomes, pushes excluded |
dimensionless share | economics contract section 3.

## Conditional typing

Every conditional decision carries one type: `enforced_rule` (an input the
Lifecycle filters or blocks) or `expected_outcome` (a result the Lifecycle
should produce but does not enforce). No other type is accepted.

## Blocking rule

Architectural Alignment and Scope cannot return `WORKSPACE_READY` or
`WORKSPACE_RESUMED` (shared understanding confirmed and ready for planning)
while any decision cites an undefined quantity or an untyped conditional. The
batch stays open, the stage returns `OWNER_DECISION_REQUIRED`, and each missing
definition is listed as an owner-stops class C question.

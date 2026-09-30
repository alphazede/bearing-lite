# Final Decision Batch

The final batch carries every confirmed decision plus the definitions those
decisions depend on. Planning and Design copies the table; it never redefines it.

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

`SHARED_UNDERSTANDING_CONFIRMED` is blocked while any decision cites an
undefined quantity or an untyped conditional. The batch stays open and each
missing definition is listed as an owner-stops class C question.

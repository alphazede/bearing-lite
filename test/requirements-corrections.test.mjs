/**
 * requirements-author-corrections: the Requirements Engineer corrects concrete
 * quality-gate findings inside its authoring bounds. That loop is author
 * evidence, distinct from independent review, and consumes no review or
 * repair budget. The shipped skill text is the product interface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_IDENTIFIER,
  assertContracts,
  assertLinksTo,
  assertLocalLinksResolve,
  flat,
  readIfShipped,
  readShipped,
} from "./skill-contract-fixture.mjs";

const RE_SKILL = "skills/requirements-engineer/SKILL.md";
const GATE_REF = "skills/requirements-engineer/references/quality-gate.md";
const REPORT_REF = "skills/requirements-engineer/references/gate-report.md";

const reSurface = () => flat(readIfShipped(RE_SKILL) + "\n" + readIfShipped(GATE_REF));

describe("requirements-author-corrections", () => {
  it("RC-01 the quality-gate reference ships and the Requirements Engineer links it", () => {
    readShipped(GATE_REF);
    assertLinksTo(RE_SKILL, GATE_REF);
  });

  it("RC-02 every checklist row resolves to PASS, FAIL, or justified N/A", () => {
    const text = flat(readShipped(GATE_REF));
    assertContracts(
      text,
      {
        "every row is evaluated": /(load|evaluate|apply)[^.]*every[^.]*(checklist )?row/,
        "skipping a row is FAIL": /skipping a row is fail/,
        "N/A needs a scope reason": /n\/a[^.]*(scope )?reason/,
        "a blank N/A reason becomes FAIL": /blank reason (becomes|is) fail/,
        "PASS only if every row is PASS or justified N/A": /pass if every row is pass or (a )?justified n\/a/,
        "any FAIL row fails the gate": /fail if any row is fail/,
      },
      GATE_REF
    );
  });

  it("RC-03 a failing row records its typed failure and evidence without new codes", () => {
    const text = flat(readShipped(GATE_REF));
    assertContracts(
      text,
      {
        "record typed failure and evidence": /typed failure and (the )?evidence/,
        "do not invent a new failure code": /(do not|never) invent a new failure code/,
      },
      GATE_REF
    );
  });

  it("RC-04 concrete findings go back to the author, who rechecks the affected rows", () => {
    const text = flat(readShipped(GATE_REF));
    assertContracts(
      text,
      {
        "return concrete failures to the author": /return concrete (failures|findings) to the author/,
        "recheck affected rows after correction": /recheck affected rows after correction/,
      },
      GATE_REF
    );
  });

  it("RC-05 corrections stay in scope and stop on pass, typed gap, or no new evidence", () => {
    const text = reSurface();
    assertContracts(
      text,
      {
        "corrections within the assigned scope": /corrections within the assigned scope/,
        "correct concrete findings and recheck affected requirements":
          /correct concrete findings[^.]*recheck affected requirements/,
        "retain candidate-bound evidence": /retain candidate-bound evidence/,
        "no fixed correction-round limit": /(do not impose a fixed correction-round limit|no fixed correction-round limit)/,
        "stop when the quality gate passes": /stop when the quality gate passes/,
        "typed gap stops corrections": /stop when[^.]*a typed gap prevents progress/,
        "stop when no new evidence, hypothesis, or strategy exists":
          /no new evidence, hypothesis,? or strategy/,
        "preserve an explicit owner-set limit": /preserve any explicit owner-set limit|explicit owner-set limit/,
      },
      `${RE_SKILL} + ${GATE_REF}`
    );
  });

  it("RC-06 author corrections are not independent review and spend none of its budget", () => {
    for (const rel of [RE_SKILL, GATE_REF]) {
      const text = flat(readShipped(rel));
      assertContracts(
        text,
        {
          "not independent review": /not (an )?independent review|does not create an independent review/,
          "consumes no review or repair budget":
            /(do not|does not|never)[^.]*(consume|spend)[^.]*review or repair budget/,
        },
        rel
      );
    }
    assertContracts(
      reSurface(),
      {
        "preserve the caller's selected review cadence": /preserve the caller'?s selected (final )?review cadence/,
        "no additional review checkpoint": /no additional review checkpoint/,
      },
      `${RE_SKILL} + ${GATE_REF}`
    );
  });

  it("RC-07 the gate is a procedure that neither authors, persists, publishes, nor picks models", () => {
    const text = flat(readShipped(GATE_REF));
    assertContracts(
      text,
      {
        "gate does not author": /do not author here/,
        "gate does not persist or publish": /(do not persist|never persist)/,
        "publication typed-gap routing": /typed_gap_persistence \| [^|]*publish the register \| the register host workflow/,
        "gate does not choose models": /do not choose models/,
        "record is not review or publication": /not treat this record as[^.]*review[^.]*publication/,
      },
      GATE_REF
    );
  });

  it("RC-08 the existing self-check loop and compact gate report remain", () => {
    assertLinksTo(RE_SKILL, REPORT_REF);
    const skill = flat(readShipped(RE_SKILL));
    assertContracts(
      skill,
      {
        "author, self-check, repair, recheck loop": /author → self requirements-quality pass → repair own requirements → recheck → return/,
        "self-checks are author evidence": /self-checks are author evidence, not independent review/,
      },
      RE_SKILL
    );
  });

  it("RC-09 the reference resolves every local link and carries no private identifiers", () => {
    assertLocalLinksResolve(GATE_REF);
    const text = readShipped(GATE_REF);
    assert.doesNotMatch(text, PRIVATE_IDENTIFIER, GATE_REF);
  });
});

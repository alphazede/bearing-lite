/**
 * real-application-verification: a reusable repository-local procedure that
 * drives the real application through UI, CLI, or API, isolates its
 * environment, retains evidence through cleanup, and travels with the
 * integrated candidate. The shipped skill text is the product interface.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_IDENTIFIER,
  assertContracts,
  assertLinksTo,
  assertLocalLinksResolve,
  flat,
  readShipped,
} from "./skill-contract-fixture.mjs";

const TE_SKILL = "skills/test-engineer/SKILL.md";
const IE_SKILL = "skills/integration-engineer/SKILL.md";
const RAV_REF = "skills/test-engineer/references/real-app-verification.md";

describe("real-application-verification", () => {
  it("RAV-01 the procedure reference ships and the Test Engineer links it", () => {
    readShipped(RAV_REF);
    assertLinksTo(TE_SKILL, RAV_REF);
  });

  it("RAV-02 one repository-local procedure is reused or maintained, discovered from code", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "reuse or maintain one repository-local procedure":
          /reuse or maintain one (repository|repo)-local (procedure|skill)/,
        "beside existing verification assets": /beside existing verification assets/,
        "discover commands and harnesses from code": /discover commands and harness(es)? from (the )?code/,
        "ask only for unobservable prerequisites": /ask only for unobservable prerequisites/,
      },
      RAV_REF
    );
  });

  it("RAV-03 features map to cases with drive steps and observable end states", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "map features and entry points to cases": /map[^.]*features and entry points[^.]*cases/,
        "preconditions, drive steps, observable end states, known limitations":
          /preconditions[^.]*drive steps[^.]*observable end states[^.]*known limitations/,
        "report unmapped surfaces": /report unmapped surfaces/,
        "no second requirements authority": /never create another requirements authority|no (second|other|new) requirements authority/,
      },
      RAV_REF
    );
  });

  it("RAV-04 launch, data setup, readiness, and a read-only doctor are recorded", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "exact launch or build command": /exact launch(\/build| or build|, build)?/,
        "migrations and seeds": /migrations?[^.]*seeds?/,
        "usable-readiness signal": /readiness signal/,
        "read-only doctor": /read-only doctor/,
      },
      RAV_REF
    );
  });

  it("RAV-05 the real environment is isolated and protected actions keep their authority", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "isolate ports, data and profiles": /isolate ports[^.]*data[^.]*profiles/,
        "serialize shared instances": /seriali[sz]e shared instances/,
        "respect protected-action authority": /protected-action authority/,
        "use safe fixtures": /safe fixtures/,
      },
      RAV_REF
    );
  });

  it("RAV-06 real UI, CLI, and API paths are driven and their effects captured", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "drive real UI/CLI/API paths": /drive real ui\/cli\/api paths|drive real ui, cli,? (and|or) api paths/,
        "stable selectors or commands": /stable selectors/,
        "capture action plus result": /capture action (plus|and) result/,
        "file, database, delivery effects": /file\/database\/delivery effects|file, database,? (and|or) delivery effects/,
        "mocks only at established external boundaries": /mocks only at established external boundar/,
        "preserve missing-precondition failures": /preserve missing-precondition failures/,
      },
      RAV_REF
    );
  });

  it("RAV-07 cleanup survives failure and leaves retained evidence in place", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "evidence paths outside scratch state": /evidence paths outside scratch state/,
        "clean only owned processes and resources": /clean only owned processes/,
        "cleanup also runs after failures": /including after failures|after failures/,
        "retain proof and verify it survives": /retain proof and verify it survives/,
      },
      RAV_REF
    );
  });

  it("RAV-08 the procedure is trialled end to end before it is claimed usable", () => {
    const text = flat(readShipped(RAV_REF));
    assertContracts(
      text,
      {
        "trial end to end on one mapped feature": /trial the procedure end to end on one mapped feature/,
        "remaining features stay unverified": /remaining features[^.]*unverified/,
        "trial does not replace case coverage, reliability or independent assurance":
          /does not replace case coverage[^.]*reliability[^.]*independent[^.]*assurance/,
        "unrun procedure is missing evidence": /unrun[^.]*needs_(more_)?evidence/,
      },
      RAV_REF
    );
  });

  it("RAV-09 Integration Engineer hands the candidate on with the procedure, which is not assurance", () => {
    assertLinksTo(IE_SKILL, RAV_REF);
    const text = flat(readShipped(IE_SKILL));
    assertContracts(
      text,
      {
        "candidate handoff carries the real-app procedure": /candidate[^.]*real-app verification procedure|real-app verification procedure[^.]*candidate/,
        "procedure availability is not assurance": /procedure availability[^.]*not assurance/,
      },
      IE_SKILL
    );
  });

  it("RAV-10 the reference resolves every local link and carries no private identifiers", () => {
    assertLocalLinksResolve(RAV_REF);
    assert.doesNotMatch(readShipped(RAV_REF), PRIVATE_IDENTIFIER, RAV_REF);
  });
});

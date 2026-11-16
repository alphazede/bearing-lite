/**
 * test-expectations-and-coverage-reuse: independent oracles, circular
 * expectation rejection, legitimate text/configuration contracts, coverage
 * reuse, the TDD regression sequence, and shared-machine discipline.
 * The shipped skill text is the product interface under test.
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

const TE_SKILL = "skills/test-engineer/SKILL.md";
const CASE_REF = "skills/test-engineer/references/verification-case.md";
const SHARED_REF = "skills/test-engineer/references/shared-machine-tests.md";
const IMPL_SKILL = "skills/implementer/SKILL.md";
const TDD_REF = "skills/implementer/references/tdd.md";

/** Test Engineer surface: the skill plus its verification-case reference. */
const teSurface = () => flat(readIfShipped(TE_SKILL) + "\n" + readIfShipped(CASE_REF));

describe("test-expectations-and-coverage-reuse", () => {
  it("TEX-01 verification-case reference ships and the Test Engineer links it", () => {
    readShipped(CASE_REF);
    assertLinksTo(TE_SKILL, CASE_REF);
  });

  it("TEX-02 an oracle is an independently justified basis for the expected result", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "oracle defined": /oracle/,
        "independent basis": /independent(ly)? (justified|basis|source)/,
        "requirement or specification basis": /requirement[^.]*specification|specification[^.]*requirement/,
        "independently worked example": /independently worked example/,
        "published constant or external contract": /published constant|external contract/,
        "computed expectation valid when its basis is independent": /computed expectations? (are|is|remain)? ?valid[^.]*independent/,
        "case names a plausible wrong behavior it rejects": /plausible wrong behavio/,
      },
      CASE_REF
    );
  });

  it("TEX-03 calling the production helper for its own expected value is circular", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "production helper computing its own expectation is circular":
          /(calling|call|uses?|using) the production (helper|code|function)[^.]*(expected|expectation)[^.]*circular|circular[^.]*production (helper|code|function)/,
        "copied formula without independent justification is circular":
          /cop(y|ying|ied) (its|the) formula[^.]*(without|lacking) independent justification/,
        "missing justification stays an evidence gap": /missing justification[^.]*(evidence gap|gap)/,
        "never invent an expected value": /(do not|never) invent[^.]*expected (value|result)/,
      },
      CASE_REF
    );
  });

  it("TEX-04 executable tests assert observable behavior, not implementation-string proxies", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "assert observable behavior, state, output or effects":
          /observable behavio[u]?r[^.]*(state|output|effects?)/,
        "implementation strings or tokens are not behavior proof":
          /implementation (strings?|text)[^.]*(tokens?|ast)[^.]*(does|do) not prove/,
        "incidental snapshots are not proof": /incidental snapshots?/,
        "source inspection remains valid under inspection or analysis":
          /source inspection[^.]*(inspection|analysis) method/,
      },
      CASE_REF
    );
  });

  it("TEX-05 legitimate text, byte, and configuration contracts check their real meaning", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "text or bytes that are themselves the product": /text or bytes (are|is) (themselves )?the product/,
        "generated output, serialized protocol, persisted state, owned snapshot":
          /generated[^.]*output[^.]*serialized protocols?[^.]*persisted state[^.]*(explicitly )?owned snapshot/,
        "name the contract and check actual output": /name the contract[^.]*actual output/,
        "declarative configuration uses the real consumer": /declarative configuration[^.]*real consumer/,
        "otherwise parse a typed or normalized model, not raw substrings":
          /(typed|normali[sz]ed)[^.]*(semantic )?model[^.]*(rather than|not) raw substrings?/,
        "external-boundary mocks stay valid for an independent contract": /external[- ]boundary mocks?/,
      },
      CASE_REF
    );
  });

  it("TEX-06 repair circular or proxy tests from independent evidence before pruning", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "repair expectation before pruning": /repair the expectation[^.]*before (considering )?prun/,
        "preserve independently authored tests": /preserve[^.]*independently authored tests/,
        "respect the assigned write set": /assigned write set/,
        "never silently remove the only check": /(do not|never) [^.]*silently remove the only check/,
      },
      CASE_REF
    );
  });

  it("TEX-07 prompt-text checks verify the text interface, not model obedience", () => {
    const text = flat(readShipped(CASE_REF));
    assertContracts(
      text,
      {
        "agent instructions: deterministic check of the emitted prompt":
          /agent instructions?[^.]*deterministic check[^.]*(emitted|final) prompt/,
        "cannot establish model obedience": /cannot establish (that )?(a|the) model (obeys|follows)/,
        "forward tasks matching and non-matching":
          /matching[^.]*non-matching[^.]*(forward )?tasks?|forward tasks?[^.]*matching[^.]*non-matching/,
        "no live-model CI requirement": /no live[- ]model ci/,
      },
      CASE_REF
    );
  });

  it("TEX-08 coverage reuse: inventory and extend before adding, never optimize test count", () => {
    const text = teSurface();
    assertContracts(
      text,
      {
        "inventory cases, fixtures, harnesses and gate membership":
          /inventor(y|ies)[^.]*cases[^.]*fixtures[^.]*harness(es)?[^.]*gate membership/,
        "extend or parameterize the closest coverage first": /extend[^.]*(or )?parameteri[sz]e[^.]*(closest|existing)/,
        "justify a new test by a distinct observable contract": /justify[^.]*(separate|new|distinct)[^.]*(tests?|cases?|modules?)[^.]*distinct (observable )?contract/,
        "preserve valid coverage": /preserve valid coverage/,
        "never optimize test count": /never optimi[sz]e test count/,
        "record extended, new, replaced and deleted cases with reasons":
          /extended[^.]*new[^.]*replaced[^.]*deleted[^.]*reasons?/,
      },
      `${TE_SKILL} + ${CASE_REF}`
    );
  });

  it("TEX-09 TDD sequence reference ships and the Implementer links it", () => {
    readShipped(TDD_REF);
    assertLinksTo(IMPL_SKILL, TDD_REF);
  });

  it("TEX-10 TDD sequence runs red on unfixed code, hands off, then reruns the same cases green", () => {
    const text = flat(readShipped(TDD_REF));
    const steps = [
      ["name the behavior and smallest real reproduction", /smallest real reproduction/],
      ["inventory existing coverage", /inventory existing cases/],
      ["run against the unfixed revision", /(run|execute)[^.]*against the (identified )?unfixed revision/],
      ["record case ids, inputs, command, observed failure", /case ids?[^.]*(input|fixture)[^.]*command[^.]*observed failure/],
      ["hand failure evidence to the product author", /failure evidence to the (authorized )?product author/],
      ["rerun the same case ids and inputs on the candidate", /same case ids? and inputs? on the (repaired )?candidate/],
      ["report red and green revisions", /red and green revisions/],
    ];
    const positions = steps.map(([name, re]) => {
      const m = re.exec(text);
      return { name, at: m ? m.index : -1 };
    });
    const missing = positions.filter((p) => p.at < 0).map((p) => p.name);
    assert.deepEqual(missing, [], `${TDD_REF} is missing steps: ${missing.join("; ")}`);
    const order = positions.map((p) => p.name);
    const sorted = [...positions].sort((a, b) => a.at - b.at).map((p) => p.name);
    assert.deepEqual(sorted, order, `${TDD_REF} steps must appear in TDD order`);
  });

  it("TEX-11 only the intended failure counts as red evidence", () => {
    const text = flat(readShipped(TDD_REF));
    assertContracts(
      text,
      {
        "collection error, missing service, timeout, unrelated assertion are not red":
          /collection error[^.]*missing service[^.]*timeout[^.]*unrelated assertion[^.]*not the intended red/,
        "a passing case does not establish regression proof": /passing case does not establish regression proof/,
        "classify preparation, environment, harness and expected-negative failures first":
          /classify preparation[^.]*environment[^.]*harness[^.]*expected[- ]negative/,
        "no speculative batch before the first real failure": /speculative tests? before[^.]*first real failure/,
      },
      TDD_REF
    );
  });

  it("TEX-12 green is never obtained by blessing a wrong result or retrying a flake", () => {
    const text = flat(readShipped(TDD_REF));
    assertContracts(
      text,
      {
        "do not change assertions to bless a wrong result": /(do not|never) change assertions to bless a wrong result/,
        "a flaky result needs a new causal hypothesis": /flaky result needs a new causal hypothesis/,
        "repeating until green is not a repair": /repeating it until green is not a repair|repeat(ing)? until green is not a repair/,
        "preserve the original red evidence": /preserve the original red evidence/,
        "source inspection or manual reproduction does not satisfy executable red/green":
          /(source inspection|manual reproduction)[^.]*does not satisfy[^.]*(executable )?red\/green/,
      },
      TDD_REF
    );
  });

  it("TEX-13 separate test and product authorship hand off evidence and serialize per feature", () => {
    const text = flat(readShipped(TDD_REF));
    assertContracts(
      text,
      {
        "compact case/evidence handoff between authors": /compact case\/evidence handoff/,
        "neither author writes the other's paths": /(do not authori[sz]e either|neither)[^.]*(write|writes) the other'?s paths/,
        "serialize one feature's red/repair/green": /seriali[sz]e[^.]*red\/repair\/green/,
        "independent features may run concurrently": /independent features may (progress|run) concurrently/,
        "never changes roles, models or review cadence": /never changes roles[^.]*models[^.]*review cadence/,
      },
      TDD_REF
    );
  });

  it("TEX-14 the TDD sequence binds shared-machine discipline, which keeps its rules", () => {
    assertLinksTo(TDD_REF, SHARED_REF);
    const shared = flat(readShipped(SHARED_REF));
    assertContracts(
      shared,
      {
        "bind port 0 rather than free-and-rebind": /bind port 0/,
        "assert only on resources the test created": /assert only on resources the test created/,
        "one bounded readiness deadline": /one bounded deadline/,
        "named cross-process lock": /cross-process lock/,
        "unique temporary root removed on every path": /unique temporary root[^.]*every path/,
        "five consecutive runs and two concurrent copies": /5 consecutive[^.]*two concurrent copies/,
      },
      SHARED_REF
    );
  });

  it("TEX-15 new references resolve every local link and carry no private identifiers", () => {
    for (const rel of [CASE_REF, TDD_REF]) {
      assertLocalLinksResolve(rel);
      assert.doesNotMatch(readShipped(rel), PRIVATE_IDENTIFIER, rel);
    }
  });
});

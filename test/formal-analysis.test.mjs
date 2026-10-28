/**
 * optional-formal-analysis: an optional Test Engineer method with property
 * selection, model/code correspondence, a scratch mutation that proves the
 * checker can fail, a restored baseline, and recorded bounds and assumptions.
 * It adds no mandatory role, gate, or toolchain. The shipped skill text is
 * the product interface.
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
  section,
} from "./skill-contract-fixture.mjs";

const TE_SKILL = "skills/test-engineer/SKILL.md";
const IE_SKILL = "skills/integration-engineer/SKILL.md";
const FA_REF = "skills/test-engineer/references/formal-analysis.md";

describe("optional-formal-analysis", () => {
  it("FA-01 the formal-analysis reference ships and the Test Engineer links it", () => {
    readShipped(FA_REF);
    assertLinksTo(TE_SKILL, FA_REF);
  });

  it("FA-02 formal analysis is optional and adds no gate, role, or required tool", () => {
    const raw = readShipped(FA_REF);
    const text = flat(raw);
    assertContracts(
      text,
      {
        "optional path": /optional (analysis )?(path|method)/,
        "only when a named requirement or risk calls for it":
          /named requirement[^.]*(risk)[^.]*(invariant|ordering|safety|exhaustive)/,
        "no universal gate": /no universal (pr )?gate/,
        "no extra or mandatory role": /no (extra|additional|new|mandatory) (assurance )?role/,
      },
      FA_REF
    );
    assert.doesNotMatch(
      text,
      /(must|always) (use|run) (tla\+|alloy|coq|lean|kani|cbmc|spin|nusmv|dafny)/,
      `${FA_REF} must not lock a specific verifier`
    );
  });

  it("FA-03 one consequential property is selected and its harm stated plainly", () => {
    const text = flat(readShipped(FA_REF));
    assertContracts(
      text,
      {
        "select one question": /select one (question|property)/,
        "record property and user harm in plain language": /property and (user )?harm in plain language/,
        "explain the choice; other targets stay unverified": /other targets as unverified|other targets[^.]*unverified/,
        "no repository-wide proof campaign": /(do not|never) expand into a repository-wide proof campaign|no repository-wide proof campaign/,
      },
      FA_REF
    );
  });

  it("FA-04 tooling is reused or acquired by policy, and generated-input tests are not proofs", () => {
    const text = flat(readShipped(FA_REF));
    assertContracts(
      text,
      {
        "reuse installed harnesses first": /reuse installed harness(es)? first/,
        "follow repository supply-chain policy": /supply-chain policy/,
        "generated-input testing is never a formal proof": /generated-input testing[^.]*never label it a formal proof|generated-input[^.]*not a formal proof/,
        "no verifier is an unavailable outcome": /unavailable/,
        "distinguish missing evidence, unavailable tooling and blockers":
          /missing evidence[^.]*unavailable tooling[^.]*(authority|preparation) (or preparation )?blocker/,
      },
      FA_REF
    );
  });

  it("FA-05 model or proof elements correspond to named code and a confirmed revision", () => {
    const text = flat(readShipped(FA_REF));
    assertContracts(
      text,
      {
        "covered source files and functions map to model or proof elements":
          /covered source files\/functions[^.]*(model or proof|model\/proof) elements/,
        "state, transitions and atomicity grounded in implementation steps":
          /state, transitions,? and atomicity grounded in (actual )?implementation steps/,
        "tool identity and version with exact command": /tool identity\/version[^.]*exact command|tool (identity|name)[^.]*version[^.]*exact command/,
        "last confirmed revision recorded": /last revision at which[^.]*confirmed|confirmed revision/,
        "stale abstraction is not candidate evidence": /stale abstraction is not candidate evidence/,
        "never weaken properties to obtain a pass": /(do not|never) weaken propert(y|ies) to obtain a pass/,
      },
      FA_REF
    );
  });

  it("FA-06 assumptions, bounds, and the scope of the claim are explicit", () => {
    const text = flat(readShipped(FA_REF));
    assertContracts(
      text,
      {
        "explicit environmental assumptions, finite bounds, omissions":
          /environmental assumptions[^.]*finite bounds[^.]*omissions/,
        "model, bounded implementation, or unrestricted claim": /model, (a )?bounded implementation,? or (an )?unrestricted claim/,
        "timeout or incomplete search is not a proved property": /timeout or incomplete search is not a proved property/,
      },
      FA_REF
    );
  });

  it("FA-07 a scratch mutation proves the checker fails, then the baseline is restored", () => {
    const raw = readShipped(FA_REF);
    const text = flat(raw);
    const steps = [
      ["preserve the baseline result", /preserve its baseline result/],
      ["isolated scratch mutation in the real covered code", /isolated scratch mutation in the real covered code/],
      ["restore only owned scratch changes", /restore only owned scratch changes/],
      ["rerun the original candidate", /rerun the original candidate/],
    ];
    const at = steps.map(([name, re]) => ({ name, i: (re.exec(text) || { index: -1 }).index }));
    const missing = at.filter((s) => s.i < 0).map((s) => s.name);
    assert.deepEqual(missing, [], `${FA_REF} is missing: ${missing.join("; ")}`);
    assert.deepEqual(
      [...at].sort((a, b) => a.i - b.i).map((s) => s.name),
      steps.map(([name]) => name),
      `${FA_REF} must order baseline, mutation, restore, rerun`
    );
    assertContracts(
      text,
      {
        "mutating a detached model alone is insufficient": /mutating a detached model does not establish/,
        "preserve failure evidence and restored baseline": /preserve both failure evidence and the restored baseline/,
        "unexercised procedure needs evidence": /not exercised this way remains needs_(more_)?evidence/,
        "clean owned scratch resources after failures": /clean owned scratch resources after failures/,
      },
      FA_REF
    );
  });

  it("FA-08 counterexamples are interpreted against the source, not explained away", () => {
    const text = flat(readShipped(FA_REF));
    assertContracts(
      text,
      {
        "distinguish violation from abstraction, assumption, bound, timeout, tool error":
          /real implementation violation from a faulty abstraction[^.]*unsupported assumption[^.]*bound exhaustion[^.]*timeout[^.]*(tool|environment) error/,
        "counterexample as ordered source-level actions": /counterexample as source-level actions in order/,
        "correct a modeling error only with code evidence": /correct a modeling error only with code evidence/,
      },
      FA_REF
    );
  });

  it("FA-09 Integration Engineer carries formal artifacts with the candidate; a model pass is not system assurance", () => {
    assertLinksTo(IE_SKILL, FA_REF);
    const ie = flat(readShipped(IE_SKILL));
    assertContracts(
      ie,
      {
        "candidate carries formal-analysis artifacts and correspondence":
          /formal-analysis artifacts and code correspondence|formal[- ]analysis artifacts[^.]*correspondence/,
        "a model pass is not assurance": /model pass is not (whole-system )?assurance|(procedure availability|model pass)[^.]*not assurance/,
      },
      IE_SKILL
    );
    const handoff = flat(section(readShipped(FA_REF), /handoff/i));
    assertContracts(
      handoff,
      {
        "handoff lists result, counterexamples, assumptions, bounds, code map, revision, commands":
          /counterexamples[^.]*assumptions[^.]*bounds[^.]*covered-code map[^.]*confirmed revision[^.]*commands/,
        "neither assembly nor a model pass establishes whole-system assurance":
          /neither assembly nor a formal model pass establishes whole-system assurance/,
      },
      `${FA_REF} handoff section`
    );
  });

  it("FA-10 the reference resolves every local link and carries no private identifiers", () => {
    assertLocalLinksResolve(FA_REF);
    assert.doesNotMatch(readShipped(FA_REF), PRIVATE_IDENTIFIER, FA_REF);
  });
});

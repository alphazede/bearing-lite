/**
 * design-lens: the OOPDSA Implementation Design section in design.md, its
 * slice `design_lenses` mapping, packet rows, Implementer adherence, and
 * Reviewer verification against named owners, data structures, algorithms,
 * and complexity bounds. The shipped skill text is the product interface;
 * the implementation schema is the real consumer of `design_lenses`.
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

const PD_SKILL = "skills/planning-and-design/SKILL.md";
const OOPDSA_REF = "skills/planning-and-design/references/oopdsa-design.md";
const IMPL_SKILL = "skills/implementer/SKILL.md";
const REVIEWER_SKILL = "skills/reviewer/SKILL.md";
const LENS = "OOPDSA Implementation Design";

const SUBSECTIONS = [
  "Requirements trace",
  "Ownership and boundaries",
  "Pattern and plain-code decisions",
  "Data structures and algorithms",
  "Edge cases and invariants",
  "SEIT proof obligations",
];

describe("design-lens (OOPDSA)", () => {
  it("OD-01 the OOPDSA reference ships and final Planning and Design links it", () => {
    readShipped(OOPDSA_REF);
    assertLinksTo(PD_SKILL, OOPDSA_REF);
  });

  it("OD-02 design.md gains an OOPDSA Implementation Design section with six ordered subsections", () => {
    const raw = readShipped(OOPDSA_REF);
    assert.match(raw, /## OOPDSA Implementation Design/, `${OOPDSA_REF} must name the design.md heading`);
    const text = flat(section(raw, /^Plan:/));
    // Planning definitions must stay inside Plan, not in a later role's section.
    const from = text.indexOf(LENS.toLowerCase());
    const at = SUBSECTIONS.map((name) => ({ name, i: from < 0 ? -1 : text.indexOf(name.toLowerCase(), from) }));
    const missing = at.filter((s) => s.i < 0).map((s) => s.name);
    assert.deepEqual(missing, [], `${OOPDSA_REF} is missing subsections: ${missing.join("; ")}`);
    assert.deepEqual(
      [...at].sort((a, b) => a.i - b.i).map((s) => s.name),
      SUBSECTIONS,
      `${OOPDSA_REF} subsections must appear in order`
    );
  });

  it("OD-03 each subsection fixes owners, structures, complexity, invariants, and proof rows", () => {
    const text = flat(readShipped(OOPDSA_REF));
    assertContracts(
      text,
      {
        "trace each requirement or contract ID to its owning module, class, or function":
          /one line per requirement[^.]*owning module, class,? or function/,
        "state holders, permitted mutators, interfaces": /state holders, permitted mutators/,
        "reuse existing components first": /reuse existing components first|name the reused abstraction/,
        "simpler options rejected and layers omitted": /simpler options rejected/,
        "structure, key, access pattern, time/space complexity":
          /structure, key, access pattern, time\/space complexity/,
        "measured cost or marked unmeasured": /unmeasured/,
        "empty, duplicate, boundary, ordering, failure cases with typed results":
          /empty, duplicate, boundary, ordering,? and failure cases[^.]*typed result/,
        "SEIT row proves each invariant and complexity bound": /seit row proving each invariant and each complexity bound/,
      },
      OOPDSA_REF
    );
  });

  it("OD-04 a trivial plan records an explicit skip with its reason", () => {
    assert.match(readShipped(OOPDSA_REF), /oopdsa_skip: trivial - <reason>/);
  });

  it("OD-05 each non-trivial slice names the lens in design_lenses, which the schema requires", () => {
    const text = flat(readShipped(OOPDSA_REF));
    assertContracts(
      text,
      {
        "non-trivial slice lists the lens in design_lenses": /non-trivial slice.{0,80}lists oopdsa implementation design in design_lenses/,
        "slice lists its owned requirement or contract IDs": /its owned [^.]*ids/,
      },
      OOPDSA_REF
    );
    const schema = JSON.parse(readShipped("schemas/implementation.schema.json"));
    const slice = schema.$defs.slice;
    assert.ok(slice.required.includes("design_lenses"), "slices must require design_lenses");
    const list = schema.$defs[slice.properties.design_lenses.$ref.split("/").pop()];
    assert.equal(list.type, "array");
    assert.equal(list.items?.type, "string", "design_lenses entries are lens-name strings");
    if (list.items?.minLength) assert.ok(LENS.length >= list.items.minLength);
  });

  it("OD-06 packets carry the slice's OOPDSA rows, and a lens name alone is incomplete", () => {
    const text = flat(readShipped(OOPDSA_REF));
    assertContracts(
      text,
      {
        "rows copied into STATE / INPUTS": /state \/ inputs/,
        "owner component, structures, complexity bounds, invariants":
          /owner component, structures, complexity bounds,? and invariants/,
        "cite the design.md heading": /cite the design\.md heading/,
        "RETURN / STOP requires every deviation as a finding": /return \/ stop[^.]*every deviation as a finding/,
        "a lens name alone is an incomplete packet": /lens name alone is an incomplete packet/,
      },
      OOPDSA_REF
    );
  });

  it("OD-07 the Implementer follows the rows and routes a proven-invalid row through amendment", () => {
    assertLinksTo(IMPL_SKILL, OOPDSA_REF);
    assert.match(flat(readShipped(IMPL_SKILL)), /oopdsa|design lens/, IMPL_SKILL);
    const implement = flat(section(readShipped(OOPDSA_REF), /^Implement/i));
    assertContracts(
      implement,
      {
        "use the named owners, structures and bounds": /uses? the named owners, structures,? and bounds/,
        "local choices stay discretionary when rows hold": /discretionary/,
        "proven-invalid row stops affected work": /stop affected work/,
        "record the amendment before affected work resumes": /amendment before affected (implementation|work) resumes/,
        "report deviation and its evidence": /report the deviation and its evidence/,
      },
      `${OOPDSA_REF} Implement section`
    );
  });

  it("OD-08 the Reviewer checks the candidate against the rows under the normal evidence rule", () => {
    assertLinksTo(REVIEWER_SKILL, OOPDSA_REF);
    assert.match(flat(readShipped(REVIEWER_SKILL)), /oopdsa|design lens/, REVIEWER_SKILL);
    const review = flat(section(readShipped(OOPDSA_REF), /^Review/i));
    assertContracts(
      review,
      {
        "misplaced owner is a finding": /misplaced owner/,
        "structure or algorithm breaking the stated bound on a reachable path":
          /breaking the stated bound on a reachable path/,
        "unreported deviation is a finding": /unreported deviation/,
        "file:line plus reproducer, benchmark or failing test": /file:line plus a reproducer, benchmark,? or failing test/,
        "style preferences are not findings": /style preferences are not findings/,
      },
      `${OOPDSA_REF} Review section`
    );
  });

  it("OD-09 the acting role states applied, skipped, or gap; loading alone proves nothing", () => {
    const raw = readShipped(OOPDSA_REF);
    for (const line of ["OOPDSA: applied", "OOPDSA: skipped - <reason>", "OOPDSA: gap - <missing input>"]) {
      assert.ok(raw.includes(line), `${OOPDSA_REF} must name return line ${line}`);
    }
    assert.match(flat(raw), /loading proves nothing by itself/);
  });

  it("OD-10 the lens adds no role, review, or gate and no unneeded classes or layers", () => {
    const text = flat(readShipped(OOPDSA_REF));
    assertContracts(
      text,
      {
        "adds no role, review or gate": /adds no role, review,? or gate/,
        "no classes, layers or patterns the change does not need":
          /(do not|never)( use to)? add classes, layers,? or patterns[^.]*(does not|doesn't) need/,
      },
      OOPDSA_REF
    );
  });

  it("OD-11 the reference resolves every local link and carries no private identifiers", () => {
    assertLocalLinksResolve(OOPDSA_REF);
    assert.doesNotMatch(readShipped(OOPDSA_REF), PRIVATE_IDENTIFIER, OOPDSA_REF);
  });
});

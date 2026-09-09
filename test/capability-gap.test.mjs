/**
 * AC-EMV-012 / DES-EMV-024 / CONTRACT-EMV-012 / RISK-EMV-003 / SEIT-EMV-012 / SEIT-EMV-033
 *
 * Activation is selected OR required. Unavailability of an activated capability
 * is a typed capability gap, not success and not invented behavior. Only
 * unselected AND unrequired absence stays inactive / not a global failure.
 *
 * resolveCapability is a test-local reference model of that rule. It is not
 * shipped consumer proof. Passing reference-model rows must not be cited as
 * package-consumer evidence. Shipped SKILL.md / README.md assertions below
 * are the instruction proof.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const ROUTER_SKILL = path.join(ROOT, "skills/bearing-lite/SKILL.md");
const README = path.join(ROOT, "README.md");

const ALPHAZDE_METHOD_SKILLS = Object.freeze([
  "requirements-engineering",
  "sysml-modeling",
  "test-engineering",
  "integration-engineering",
]);

const OR_ACTIVATION = /select(?:s|ed)[\s-]+or[\s-]+requir(?:es|ed)/i;
const AND_ONLY_GAP =
  /selected missing required capability is a typed capability gap/i;
const TYPED_GAP = /typed capability gap/i;
const NOT_SUCCESS = /not success/i;
const NOT_INVENTED = /not invented|invented behavior/i;
const NOT_GLOBAL_FAILURE =
  /absence is not a global failure|not a global failure|not fail-closed/i;
const INACTIVE_UNSELECTED_AND_UNREQUIRED =
  /unselected[\s-]+and[\s-]+unrequired|unselected[\s-]+and[\s-]+not[\s-]+required|neither[\s-]+selected[\s-]+nor[\s-]+required|not[\s-]+selected[\s-]+and[\s-]+not[\s-]+required/i;

/**
 * @typedef {{
 *   capability: string,
 *   selected?: boolean,
 *   required?: boolean,
 *   available?: boolean,
 * }} CapabilityInput
 *
 * @typedef {{
 *   ok: true,
 *   specialized: boolean,
 *   invented: false,
 * } | {
 *   ok: false,
 *   code: string,
 *   message: string,
 *   invented: false,
 *   specialized?: boolean,
 * }} CapabilityVerdict
 */

/**
 * Test-local reference model of AC-EMV-012 / CONTRACT-EMV-012.
 * activated = selected || required. Not shipped consumer proof.
 * @param {CapabilityInput} input
 * @returns {CapabilityVerdict}
 */
export function resolveCapability(input) {
  const selected = input.selected === true;
  const required = input.required === true;
  const available = input.available === true;
  const activated = selected || required;

  if (activated && !available) {
    return {
      ok: false,
      code: "typed_capability_gap",
      message: `selected or required capability "${input.capability}" is unavailable`,
      invented: false,
    };
  }
  if (!activated) {
    return { ok: true, specialized: false, invented: false };
  }
  return { ok: true, specialized: true, invented: false };
}

function publicSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).filter((name) =>
    existsSync(path.join(SKILLS_DIR, name, "SKILL.md"))
  );
}

function shippedSurfaces() {
  return [
    ["skills/bearing-lite/SKILL.md", readFileSync(ROUTER_SKILL, "utf8")],
    ["README.md", readFileSync(README, "utf8")],
  ];
}

/**
 * @param {(text: string) => boolean} predicate
 * @param {string} detail
 */
function missingSurfaces(predicate, detail) {
  return shippedSurfaces()
    .filter(([, text]) => !predicate(text))
    .map(([label]) => `${label}: ${detail}`);
}

/** @type {readonly {
 *   name: string,
 *   selected: boolean,
 *   required: boolean,
 *   available: boolean,
 *   expect: { ok: true, specialized: boolean } | { ok: false },
 * }[]} */
const REFERENCE_TRUTH_TABLE = Object.freeze([
  {
    name: "unselected unrequired unavailable stays inactive",
    selected: false,
    required: false,
    available: false,
    expect: { ok: true, specialized: false },
  },
  {
    name: "unselected unrequired available stays inactive",
    selected: false,
    required: false,
    available: true,
    expect: { ok: true, specialized: false },
  },
  {
    name: "required-only unavailable is a typed capability gap",
    selected: false,
    required: true,
    available: false,
    expect: { ok: false },
  },
  {
    name: "required-only available activates specialized fields",
    selected: false,
    required: true,
    available: true,
    expect: { ok: true, specialized: true },
  },
  {
    name: "selected-only unavailable is a typed capability gap",
    selected: true,
    required: false,
    available: false,
    expect: { ok: false },
  },
  {
    name: "selected-only available activates specialized fields",
    selected: true,
    required: false,
    available: true,
    expect: { ok: true, specialized: true },
  },
  {
    name: "selected and required unavailable is a typed capability gap",
    selected: true,
    required: true,
    available: false,
    expect: { ok: false },
  },
  {
    name: "selected and required available activates specialized fields",
    selected: true,
    required: true,
    available: true,
    expect: { ok: true, specialized: true },
  },
]);

describe("AC-EMV-012 reference policy model (not shipped consumer proof)", () => {
  for (const row of REFERENCE_TRUTH_TABLE) {
    it(row.name, () => {
      const verdict = resolveCapability({
        capability: "specialized-method",
        selected: row.selected,
        required: row.required,
        available: row.available,
      });
      assert.equal(verdict.invented, false);
      assert.equal(verdict.ok, row.expect.ok);
      if (row.expect.ok) {
        assert.equal(verdict.ok, true);
        if (verdict.ok) {
          assert.equal(verdict.specialized, row.expect.specialized);
        }
      } else {
        assert.equal(verdict.ok, false);
        if (!verdict.ok) {
          assert.equal(verdict.code, "typed_capability_gap");
          assert.match(verdict.message, /specialized-method/);
        }
      }
    });
  }

  it("public catalog does not ship the four AlphaZede method skills", () => {
    const dirs = publicSkillDirs();
    for (const name of ALPHAZDE_METHOD_SKILLS) {
      assert.ok(!dirs.includes(name), name);
      assert.equal(existsSync(path.join(SKILLS_DIR, name, "SKILL.md")), false, name);
    }
  });
});

describe("AC-EMV-012 shipped procedure proof (SKILL.md, README.md)", () => {
  it("declares selected-or-required activation, not selected-and-required", () => {
    const misses = missingSurfaces(
      (text) => OR_ACTIVATION.test(text),
      "missing selected-or-required activation"
    );
    assert.equal(misses.length, 0, misses.join("; "));
  });

  it("AND-only gap sentence is not the shipped gap rule", () => {
    const misses = missingSurfaces(
      (text) => !AND_ONLY_GAP.test(text),
      'AND-only sentence "Selected missing required capability is a typed capability gap" remains'
    );
    assert.equal(misses.length, 0, misses.join("; "));
  });

  it("unavailability of a selected-or-required capability is a typed gap, not success or invented behavior", () => {
    const misses = [
      ...missingSurfaces(
        (text) => OR_ACTIVATION.test(text),
        "missing selected-or-required activation"
      ),
      ...missingSurfaces((text) => TYPED_GAP.test(text), "missing typed capability gap"),
      ...missingSurfaces((text) => NOT_SUCCESS.test(text), "missing not success"),
      ...missingSurfaces(
        (text) => NOT_INVENTED.test(text),
        "missing not invented / invented behavior"
      ),
    ];
    assert.equal(misses.length, 0, misses.join("; "));
  });

  it("selected-only missing and required-only missing are each typed gaps without requiring both flags", () => {
    const misses = [
      ...missingSurfaces(
        (text) => OR_ACTIVATION.test(text),
        "either flag must activate; selected-only and required-only missing are gaps"
      ),
      ...missingSurfaces(
        (text) => !AND_ONLY_GAP.test(text),
        "must not require selected and required together"
      ),
    ];
    assert.equal(misses.length, 0, misses.join("; "));
  });

  it("only unselected and unrequired absence remains inactive / not a global failure", () => {
    const misses = [
      ...missingSurfaces(
        (text) => INACTIVE_UNSELECTED_AND_UNREQUIRED.test(text),
        "inactive case must be unselected and unrequired"
      ),
      ...missingSurfaces(
        (text) => NOT_GLOBAL_FAILURE.test(text),
        "missing not a global failure"
      ),
    ];
    assert.equal(misses.length, 0, misses.join("; "));
  });

  it("unselected AlphaZede-specific skill absence is not a global failure", () => {
    const misses = missingSurfaces(
      (text) => NOT_GLOBAL_FAILURE.test(text),
      "missing not a global failure"
    );
    assert.equal(misses.length, 0, misses.join("; "));
  });
});

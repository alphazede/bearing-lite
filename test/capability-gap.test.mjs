/**
 * AC-EMV-012 / DES-EMV-024 / CONTRACT-EMV-012 / RISK-EMV-003 / SEIT-EMV-012 / SEIT-EMV-033
 * Selected missing required capability is a typed gap. Unselected AlphaZede
 * skill absence is not a global Lite failure.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = path.join(ROOT, "skills");

const ALPHAZDE_METHOD_SKILLS = Object.freeze([
  "requirements-engineering",
  "sysml-modeling",
  "test-engineering",
  "integration-engineering",
]);

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
 * Pure policy model of CONTRACT-EMV-012. Does not invent missing-skill behavior.
 * @param {CapabilityInput} input
 * @returns {CapabilityVerdict}
 */
export function resolveCapability(input) {
  const selected = input.selected === true;
  const required = input.required === true;
  const available = input.available === true;

  if (selected && required && !available) {
    return {
      ok: false,
      code: "typed_capability_gap",
      message: `selected required capability "${input.capability}" is unavailable`,
      invented: false,
    };
  }
  if (!selected) {
    return { ok: true, specialized: false, invented: false };
  }
  return { ok: true, specialized: required && available, invented: false };
}

function publicSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).filter((name) =>
    existsSync(path.join(SKILLS_DIR, name, "SKILL.md"))
  );
}

describe("AC-EMV-012 typed capability gaps (SEIT-EMV-012, SEIT-EMV-033)", () => {
  it("selected missing required capability returns a typed gap, not success or invented behavior", () => {
    const verdict = resolveCapability({
      capability: "test-engineering",
      selected: true,
      required: true,
      available: false,
    });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.code, "typed_capability_gap");
      assert.equal(verdict.invented, false);
      assert.match(verdict.message, /test-engineering/);
    }
  });

  it("unselected AlphaZede skill absence is not fail-closed", () => {
    for (const capability of ALPHAZDE_METHOD_SKILLS) {
      const verdict = resolveCapability({
        capability,
        selected: false,
        required: false,
        available: false,
      });
      assert.equal(verdict.ok, true, capability);
      if (verdict.ok) {
        assert.equal(verdict.specialized, false);
        assert.equal(verdict.invented, false);
      }
    }
  });

  it("public catalog does not ship the four AlphaZede method skills", () => {
    const dirs = publicSkillDirs();
    for (const name of ALPHAZDE_METHOD_SKILLS) {
      assert.ok(!dirs.includes(name), name);
      assert.equal(existsSync(path.join(SKILLS_DIR, name, "SKILL.md")), false, name);
    }
  });

  it("Router states typed capability gap and that unselected AlphaZede absence is not a global failure", () => {
    const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.match(router, /typed capability gap/i);
    assert.match(
      router,
      /absence is not a global failure|not a global failure|not fail-closed/i
    );
    assert.match(readme, /typed capability gap|AlphaZede-specific skills/i);
  });
});

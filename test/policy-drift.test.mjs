/** #63: the reference markdown JSON blocks equal the single runtime policy source. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const policy = require(path.join(ROOT, "hooks/policy.cjs"));
const REF = path.join(ROOT, "skills/bearing-lite/references");

const jsonBlock = (file) => {
  const block = readFileSync(path.join(REF, file), "utf8").match(/```json\n([\s\S]*?)\n```/);
  assert.ok(block, `${file} must publish one JSON block`);
  return JSON.parse(block[1]);
};

describe("policy drift (#63)", () => {
  it("review-policy.md equals PLANNING_REVIEW_POLICY", () => {
    assert.deepStrictEqual(jsonBlock("review-policy.md"), { ...policy.PLANNING_REVIEW_POLICY });
  });
  it("assurance-policy.md equals ASSURANCE_BUDGET_POLICY", () => {
    assert.deepStrictEqual(jsonBlock("assurance-policy.md"), { ...policy.ASSURANCE_BUDGET_POLICY });
  });
  it("both hooks consume the shared module", () => {
    for (const file of ["planning-review.cjs", "assurance-budget.cjs"]) {
      const text = readFileSync(path.join(ROOT, "hooks", file), "utf8");
      assert.match(text, /require\("\.\/policy\.cjs"\)/, file);
      assert.doesNotMatch(text, /const POLICY = Object\.freeze/, file);
    }
  });
  it("Alphazedehq#639: docs distinguish cadence keys from profiles.json schema session paths", () => {
    const assurance = readFileSync(path.join(REF, "assurance-policy.md"), "utf8");
    const profiles = readFileSync(path.join(REF, "profiles.md"), "utf8");
    const profilesHook = require(path.join(ROOT, "hooks/profiles.cjs"));

    assert.match(assurance, /cadence key/i);
    assert.match(assurance, /roles\.test_engineer\.sessions\.assurance/);
    assert.match(assurance, /roles\.integration_engineer\.sessions\.execution/);

    assert.doesNotMatch(profiles, /`integration_test\.planning`/);
    assert.doesNotMatch(profiles, /`test_engineer\.assurance`/);
    assert.doesNotMatch(profiles, /`scribe\.cadence`/);
    assert.match(profiles, /`roles\.integration_test\.sessions\.planning`/);
    assert.match(profiles, /`roles\.test_engineer\.sessions\.assurance`/);
    assert.match(profiles, /`roles\.scribe\.cadence`/);

    const route = { enabled: true, primary: { harness: "h", model: "m", reasoning: "high" }, ordered_fallbacks: [] };
    const valid = profilesHook.validateCatalog({
      raw: JSON.stringify({
        schema_version: 1,
        profiles: { P: { roles: { test_engineer: { sessions: { assurance: route } } } } },
      }),
    });
    assert.equal(valid.catalog_valid, true);

    const invalidShort = profilesHook.validateCatalog({
      raw: JSON.stringify({
        schema_version: 1,
        profiles: { P: { roles: { "test_engineer.assurance": route } } },
      }),
    });
    assert.equal(invalidShort.catalog_valid, false);
  });
});

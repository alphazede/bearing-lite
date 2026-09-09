/**
 * AC-EMV-026 / DES-EMV-009 / CONTRACT-EMV-017 / SEIT-EMV-026
 * ROUTER-EMV-002-001 populated user-catalog fixture and S21 procedure presence.
 *
 * Structure pass/fail lives in CMD-LITE-SCHEMA-VALIDATE (test/schema-validation.py).
 * This file inspects shipped empty bytes, the synthetic fixture, and the S21
 * candidate procedure. Extra oracles in schema-validation.py stay structure
 * tests, not shipped-procedure proof. This file does not implement selection,
 * save, freeze, or catalog policy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINEUPS_PATH = path.join(ROOT, "lineups.json");
const FIXTURE_PATH = path.join(ROOT, "test/fixtures/lineups-populated.example.json");
const LINEUPS_SCHEMA_PATH = path.join(ROOT, "schemas/lineups.schema.json");
const ROUTER_SKILL_PATH = path.join(ROOT, "skills/bearing-lite/SKILL.md");
const LINEUPS_REF_PATH = path.join(ROOT, "skills/bearing-lite/references/lineups.md");
const EMPTY_CATALOG_BYTES = '{"schema_version":1,"lineups":{}}';
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PHASES = ["planned_planning_assignments", "implementation_assignments"];
const FORBIDDEN_FIXTURE_IDENTITIES =
  /\b(Sol|Astra|Grok|Codex|Opus|gpt-5|engineering-methods-and-vnv-integration)\b/i;

const LINEUPS_MD_STATEMENTS = [
  {
    id: "inline_precedence",
    pattern: /explicit inline/i,
    meaning: "explicit inline owner choices require no catalog lookup",
  },
  {
    id: "named_exact_key",
    pattern: /exact(?: selected)? key/i,
    meaning: "named choices require a valid catalog and exact selected key",
  },
  {
    id: "defaults_recommendation",
    pattern: /recommend/i,
    meaning: "user-owned defaults are recommendations, not silent selections",
  },
  {
    id: "not_silent_grant",
    pattern: /not (?:a |an )?(?:silent )?(?:grant|authority grant)|never a silent grant/i,
    meaning: "defaults and selection are not grants or silent selections",
  },
  {
    id: "fallback_order",
    pattern: /fallback(?: array)? order|ordered_fallbacks|preserve fallback/i,
    meaning: "frozen snapshot copy preserves fallback array order",
  },
  {
    id: "create_or_replace",
    pattern: /replace/i,
    meaning: "explicit create versus replace",
  },
  {
    id: "unrelated_keys",
    pattern: /unrelated/i,
    meaning: "preserve unrelated valid keys and defaults",
  },
  {
    id: "changed_input",
    pattern: /changed-input|changed input/i,
    meaning: "refuse changed-input overwrite",
  },
  {
    id: "packaged_catalog_write",
    pattern: /packaged/i,
    meaning: "never write the packaged catalog",
  },
  {
    id: "symlink_alias",
    pattern: /symlink/i,
    meaning: "refuse resolved symlink aliases of packaged lineups.json",
  },
  {
    id: "home_resolution",
    pattern: /USERPROFILE|home_unresolved/i,
    meaning: "absolute HOME then USERPROFILE, else home_unresolved",
  },
  {
    id: "not_authority_grant",
    pattern: /authority grant/i,
    meaning: "selection is not an authority grant",
  },
];

/** ROUTER-EMV-002-001 load/save/freeze bindings the candidate procedure must state. */
const LINEUPS_MD_PROCEDURE_BINDINGS = [
  {
    id: "named_and_save_valid_catalog",
    patterns: [
      /named\s+(?:selection|choice)s?\s+and\s+save[\s\S]{0,40}valid\s+catalog|valid\s+catalog[\s\S]{0,60}named\s+(?:selection|choice)s?\s+and\s+save/i,
    ],
    meaning: "named selection and save require a valid catalog",
  },
  {
    id: "schema_draft_before_named_or_save",
    patterns: [
      /schemas\/lineups\.schema\.json/,
      /Draft 2020-12/,
      /before\s+named\s+(?:selection|choice)\s+or\s+save/i,
      /not\s+a\s+second\s+search\s+root(?:\s+for\s+user\s+data)?/i,
    ],
    meaning:
      "bind schemas/lineups.schema.json Draft 2020-12 validation before named selection or save (not a second search root for user data)",
  },
  {
    id: "duplicate_raw_keys_no_collapse",
    patterns: [
      /duplicate\s+raw\s+JSON\s+keys?/i,
      /(?:do\s+not|not)\s+silently\s+collapse/i,
    ],
    meaning: "reject duplicate raw JSON keys; do not silently collapse",
  },
  {
    id: "duplicate_roles_per_phase",
    patterns: [/duplicate\s+role\s+assignments?\s+within\s+each\s+phase/i],
    meaning: "reject duplicate role assignments within each phase",
  },
  {
    id: "ascii_casefold_load_and_save",
    patterns: [
      /ASCII\s+case-fold\s+collisions?(?:\s+consistently)?\s+on(?:\s+both)?\s+(?:load\s+and\s+save|save\s+and\s+load)/i,
    ],
    meaning: "reject ASCII case-fold collisions on both load and save",
  },
  {
    id: "defaults_resolve_exactly",
    patterns: [
      /(?:defaults?\s+keys?|references)\s+must\s+resolve\s+exactly/i,
      /unresolved\s+defaults?\s+fail(?:s)?\s+closed/i,
    ],
    meaning: "defaults keys must resolve exactly; unresolved defaults fail closed",
  },
  {
    id: "invalid_structure_or_name_load_save",
    patterns: [
      /invalid\s+structure\s+or\s+name\s+fails\s+closed\s+on(?:\s+both)?\s+(?:load\s+and\s+save|save\s+and\s+load)/i,
    ],
    meaning: "invalid structure or name fails closed on load and save",
  },
  {
    id: "freeze_sha256_configuration_digest",
    patterns: [
      /copy\s+selected\s+entries/i,
      /fallback(?:\s+array)?\s+order/i,
      /SHA-256/i,
      /configuration\s+digest/i,
      /frozen\s+snapshot\s+copy/i,
    ],
    meaning:
      "freeze copies selected entries, preserves fallback order, and binds a SHA-256 configuration digest of that frozen snapshot copy",
  },
  {
    id: "later_edits_preserve_frozen_digest",
    patterns: [
      /later\s+catalog\s+edits\s+do\s+not\s+mutate\s+(?:a\s+|the\s+)?frozen\s+snapshot(?:\s+copy)?\s+or\s+(?:its|the)\s+digest/i,
    ],
    meaning: "later catalog edits do not mutate the frozen snapshot or its digest",
  },
];

/**
 * @param {string} text
 * @param {{ id: string, pattern?: RegExp, patterns?: RegExp[], meaning: string }[]} rows
 * @returns {string[]}
 */
function missingStatementMeanings(text, rows) {
  return rows
    .filter((row) => {
      const regexes = row.patterns ?? (row.pattern ? [row.pattern] : []);
      return regexes.some((re) => !re.test(text));
    })
    .map((row) => `${row.id}: ${row.meaning}`);
}

/**
 * @param {object} assignment
 * @returns {object[] | null}
 */
function orderedFallbacks(assignment) {
  if (!assignment || !Array.isArray(assignment.ordered_fallbacks)) return null;
  return assignment.ordered_fallbacks;
}

/**
 * @param {object} catalog
 * @returns {object[] | null}
 */
function firstTwoFallbacks(catalog) {
  for (const profile of Object.values(catalog.lineups ?? {})) {
    for (const phase of PHASES) {
      const assignments = profile?.[phase];
      if (!Array.isArray(assignments)) continue;
      for (const assignment of assignments) {
        const fallbacks = orderedFallbacks(assignment);
        if (fallbacks && fallbacks.length >= 2) return fallbacks;
      }
    }
  }
  return null;
}

describe("AC-EMV-026 populated lineups catalog (SEIT-EMV-026 / ROUTER-EMV-002-001)", () => {
  it("ships package-root lineups.json as exact empty bytes with no defaults field", () => {
    assert.equal(existsSync(LINEUPS_PATH), true, "lineups.json must exist at the package root");
    const raw = readFileSync(LINEUPS_PATH);
    assert.equal(raw.toString("utf8"), EMPTY_CATALOG_BYTES);
    const parsed = JSON.parse(raw.toString("utf8"));
    assert.equal("defaults" in parsed, false);
    assert.equal("default" in parsed, false);
    assert.equal("providers" in parsed, false);
    assert.equal("models" in parsed, false);
  });

  it("example fixture exists and is a complete synthetic user catalog", () => {
    assert.equal(
      existsSync(FIXTURE_PATH),
      true,
      "test/fixtures/lineups-populated.example.json must exist",
    );
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    assert.equal(FORBIDDEN_FIXTURE_IDENTITIES.test(raw), false, raw);
    const catalog = JSON.parse(raw);
    assert.equal(catalog.schema_version, 1);
    assert.equal(typeof catalog.schema_version, "number");
    assert.equal(catalog.lineups && typeof catalog.lineups === "object" && !Array.isArray(catalog.lineups), true);
    assert.deepEqual(Object.keys(catalog.lineups).sort(), ["fixture-alpha", "fixture-beta"]);
    for (const name of Object.keys(catalog.lineups)) {
      assert.equal(NAME_PATTERN.test(name), true, name);
      const profile = catalog.lineups[name];
      for (const phase of PHASES) {
        assert.equal(Array.isArray(profile[phase]), true, `${name}.${phase}`);
        assert.ok(profile[phase].length >= 1, `${name}.${phase} minItems 1`);
        for (const assignment of profile[phase]) {
          assert.equal(typeof assignment.role, "string");
          assert.ok(assignment.role.length > 0);
          assert.equal(assignment.primary && typeof assignment.primary === "object", true);
          assert.equal(typeof assignment.primary.harness, "string");
          assert.equal(typeof assignment.primary.model, "string");
          assert.equal(typeof assignment.primary.reasoning, "string");
          assert.equal(Array.isArray(assignment.ordered_fallbacks), true);
          for (const fallback of assignment.ordered_fallbacks) {
            assert.equal(typeof fallback.condition, "string");
            assert.equal(typeof fallback.harness, "string");
            assert.equal(typeof fallback.model, "string");
            assert.equal(typeof fallback.reasoning, "string");
          }
        }
      }
    }
    const fallbacks = firstTwoFallbacks(catalog);
    assert.ok(fallbacks, "fixture must include at least two ordered fallbacks");
    assert.notDeepEqual(fallbacks[0], fallbacks[1], "fallback array order is significant");
    assert.equal(typeof catalog.defaults, "object");
    assert.equal(catalog.defaults.planning, "fixture-alpha");
    assert.equal(catalog.defaults.implementation, "fixture-beta");
    assert.equal(catalog.defaults.planning in catalog.lineups, true);
    assert.equal(catalog.defaults.implementation in catalog.lineups, true);
  });

  it("schemas/lineups.schema.json exists for CMD-LITE-SCHEMA-VALIDATE", () => {
    assert.equal(
      existsSync(LINEUPS_SCHEMA_PATH),
      true,
      "expected red on 1058f5b: missing schemas/lineups.schema.json",
    );
  });

  it("SKILL.md routes to references/lineups.md without a new planning gate", () => {
    assert.equal(existsSync(ROUTER_SKILL_PATH), true, "skills/bearing-lite/SKILL.md must exist");
    const skill = readFileSync(ROUTER_SKILL_PATH, "utf8");
    assert.equal(
      /references\/lineups\.md/.test(skill),
      true,
      "expected red on 1058f5b: no SKILL routing to references/lineups.md",
    );
    assert.equal(
      /Run Repository Fit → Set Bearings → Gather Supplies/.test(skill),
      true,
      "catalog routing must not replace the planning sequence with a new gate",
    );
    assert.equal(
      /Never add a staged lineup or route-review gate/.test(skill),
      true,
      "catalog routing must not add a staged lineup or route-review gate",
    );
  });

  it("references/lineups.md states the decided selection and save rules", () => {
    assert.equal(
      existsSync(LINEUPS_REF_PATH),
      true,
      "expected red on 1058f5b: missing skills/bearing-lite/references/lineups.md",
    );
    const text = readFileSync(LINEUPS_REF_PATH, "utf8");
    const missing = missingStatementMeanings(text, LINEUPS_MD_STATEMENTS);
    assert.deepEqual(missing, [], `references/lineups.md missing decided rules: ${missing.join("; ")}`);
  });

  it("references/lineups.md binds schema validation, semantic load/save checks, and freeze digests", () => {
    assert.equal(
      existsSync(LINEUPS_REF_PATH),
      true,
      "skills/bearing-lite/references/lineups.md must exist",
    );
    const text = readFileSync(LINEUPS_REF_PATH, "utf8");
    const missing = missingStatementMeanings(text, LINEUPS_MD_PROCEDURE_BINDINGS);
    assert.deepEqual(
      missing,
      [],
      `references/lineups.md missing ROUTER-EMV-002-001 load/save/freeze bindings: ${missing.join("; ")}`,
    );
  });
});

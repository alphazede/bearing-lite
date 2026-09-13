/**
 * AC-BDL-006 / DES-BDL-004 / SEIT-BDL-002
 * Shipped profiles.json is an empty catalog. No packaged defaults.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES_PATH = path.join(ROOT, "profiles.json");
const EMPTY_CATALOG_BYTES = '{"schema_version":1,"profiles":{}}';

/**
 * @typedef {{ code: string, message: string, field?: string }} ProfilesDiagnostic
 * @typedef {{ ok: true } | { ok: false, diagnostics: ProfilesDiagnostic[] }} ProfilesVerdict
 */

/**
 * Validate shipped catalog bytes. Does not invent populated-entry schema.
 * @param {Buffer | string} raw
 * @returns {ProfilesVerdict}
 */
export function validateEmptyProfilesCatalog(raw) {
  /** @type {ProfilesDiagnostic[]} */
  const diagnostics = [];
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (text !== EMPTY_CATALOG_BYTES) {
    diagnostics.push({
      code: "catalog_bytes_mismatch",
      message: `profiles.json must be exactly ${EMPTY_CATALOG_BYTES}`,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    diagnostics.push({
      code: "catalog_not_json",
      message: "profiles.json must be JSON",
    });
    return { ok: false, diagnostics };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "catalog_not_object",
      message: "profiles.json must be an object",
    });
    return { ok: false, diagnostics };
  }
  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (key !== "schema_version" && key !== "profiles") {
      diagnostics.push({
        code: "packaged_catalog_default",
        message: `unexpected catalog field "${key}"`,
        field: key,
      });
    }
  }
  for (const forbidden of ["providers", "models", "roles", "lineups", "default", "defaults"]) {
    if (forbidden in parsed) {
      diagnostics.push({
        code: "packaged_catalog_default",
        message: `catalog must not package ${forbidden}`,
        field: forbidden,
      });
    }
  }
  if (parsed.schema_version !== 1) {
    diagnostics.push({
      code: "schema_version_mismatch",
      message: `schema_version must be 1, got ${JSON.stringify(parsed.schema_version)}`,
      field: "schema_version",
    });
  }
  const profiles = parsed.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles) || Object.keys(profiles).length !== 0) {
    diagnostics.push({
      code: "catalog_not_empty",
      message: "profiles must be an empty object with no named profiles or defaults",
      field: "profiles",
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true };
}

describe("AC-BDL-006 empty profiles catalog (SEIT-BDL-002)", () => {
  it("ships profiles.json with exact empty catalog bytes", () => {
    assert.equal(existsSync(PROFILES_PATH), true, "profiles.json must exist at the package root (S1L writes it)");
    const raw = readFileSync(PROFILES_PATH);
    assert.equal(raw.toString("utf8"), EMPTY_CATALOG_BYTES);
    const verdict = validateEmptyProfilesCatalog(raw);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
  });

  it("does not package providers, models, roles, lineups, or default selection", () => {
    assert.equal(existsSync(PROFILES_PATH), true, "profiles.json must exist at the package root");
    const parsed = JSON.parse(readFileSync(PROFILES_PATH, "utf8"));
    assert.deepEqual(Object.keys(parsed).sort(), ["profiles", "schema_version"]);
    assert.equal(parsed.schema_version, 1);
    assert.deepEqual(parsed.profiles, {});
    assert.equal("providers" in parsed, false);
    assert.equal("models" in parsed, false);
    assert.equal("roles" in parsed, false);
    assert.equal("lineups" in parsed, false);
    assert.equal("default" in parsed, false);
    assert.equal("defaults" in parsed, false);
  });

  it("negative: populated catalog bytes fail without treating entry schema as live configuration", () => {
    const populated = JSON.stringify({
      schema_version: 1,
      profiles: { "example-profile": { provider: "invented" } },
      default: "example-profile",
    });
    const verdict = validateEmptyProfilesCatalog(populated);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const codes = new Set(verdict.diagnostics.map((d) => d.code));
      assert.ok(codes.has("catalog_bytes_mismatch"));
      assert.ok(codes.has("catalog_not_empty") || codes.has("packaged_catalog_default"));
    }
  });

  it("lineups.json is not the live packaged catalog", () => {
    assert.equal(
      existsSync(path.join(ROOT, "lineups.json")),
      false,
      "lineups.json must be removed by S1L; it is never live configuration"
    );
  });
});

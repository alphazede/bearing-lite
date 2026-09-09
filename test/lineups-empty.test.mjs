/**
 * AC-EMV-026 / DES-EMV-009 / CONTRACT-EMV-017 / SEIT-EMV-026
 * Shipped lineups.json is an empty catalog. No packaged defaults.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINEUPS_PATH = path.join(ROOT, "lineups.json");
const EMPTY_CATALOG_BYTES = '{"schema_version":1,"lineups":{}}';

/**
 * @typedef {{ code: string, message: string, field?: string }} LineupsDiagnostic
 * @typedef {{ ok: true } | { ok: false, diagnostics: LineupsDiagnostic[] }} LineupsVerdict
 */

/**
 * Validate shipped catalog bytes. Does not invent populated-entry schema.
 * @param {Buffer | string} raw
 * @returns {LineupsVerdict}
 */
export function validateEmptyLineupsCatalog(raw) {
  /** @type {LineupsDiagnostic[]} */
  const diagnostics = [];
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (text !== EMPTY_CATALOG_BYTES) {
    diagnostics.push({
      code: "catalog_bytes_mismatch",
      message: `lineups.json must be exactly ${EMPTY_CATALOG_BYTES}`,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    diagnostics.push({
      code: "catalog_not_json",
      message: "lineups.json must be JSON",
    });
    return { ok: false, diagnostics };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "catalog_not_object",
      message: "lineups.json must be an object",
    });
    return { ok: false, diagnostics };
  }
  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (key !== "schema_version" && key !== "lineups") {
      diagnostics.push({
        code: "packaged_catalog_default",
        message: `unexpected catalog field "${key}"`,
        field: key,
      });
    }
  }
  for (const forbidden of ["providers", "models", "roles", "profiles", "default", "defaults"]) {
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
  const lineups = parsed.lineups;
  if (!lineups || typeof lineups !== "object" || Array.isArray(lineups) || Object.keys(lineups).length !== 0) {
    diagnostics.push({
      code: "catalog_not_empty",
      message: "lineups must be an empty object with no profiles or defaults",
      field: "lineups",
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  return { ok: true };
}

describe("AC-EMV-026 empty lineups catalog (SEIT-EMV-026)", () => {
  it("ships lineups.json with exact empty catalog bytes", () => {
    assert.equal(existsSync(LINEUPS_PATH), true, "lineups.json must exist at the package root");
    const raw = readFileSync(LINEUPS_PATH);
    assert.equal(raw.toString("utf8"), EMPTY_CATALOG_BYTES);
    const verdict = validateEmptyLineupsCatalog(raw);
    assert.equal(verdict.ok, true, JSON.stringify(verdict));
  });

  it("does not package providers, models, roles, profiles, or default selection", () => {
    assert.equal(existsSync(LINEUPS_PATH), true, "lineups.json must exist at the package root");
    const parsed = JSON.parse(readFileSync(LINEUPS_PATH, "utf8"));
    assert.deepEqual(Object.keys(parsed).sort(), ["lineups", "schema_version"]);
    assert.equal(parsed.schema_version, 1);
    assert.deepEqual(parsed.lineups, {});
    assert.equal("providers" in parsed, false);
    assert.equal("models" in parsed, false);
    assert.equal("roles" in parsed, false);
    assert.equal("profiles" in parsed, false);
    assert.equal("default" in parsed, false);
    assert.equal("defaults" in parsed, false);
  });

  it("negative: populated catalog bytes fail without treating entry schema as live configuration", () => {
    const populated = JSON.stringify({
      schema_version: 1,
      lineups: { "example-profile": { provider: "invented" } },
      default: "example-profile",
    });
    const verdict = validateEmptyLineupsCatalog(populated);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      const codes = new Set(verdict.diagnostics.map((d) => d.code));
      assert.ok(codes.has("catalog_bytes_mismatch"));
      assert.ok(codes.has("catalog_not_empty") || codes.has("packaged_catalog_default"));
    }
  });
});

/**
 * AC-BDL-006: lineups.json is not live configuration.
 * S1L removes the packaged file. This file replaces the former empty-lineups catalog test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("AC-BDL-006 retired lineups catalog", () => {
  it("does not ship lineups.json as live configuration", () => {
    assert.equal(
      existsSync(path.join(ROOT, "lineups.json")),
      false,
      "lineups.json must be absent after S1L; runtime never reads it"
    );
  });

  it("does not ship schemas/lineups.schema.json as the live catalog schema", () => {
    assert.equal(
      existsSync(path.join(ROOT, "schemas/lineups.schema.json")),
      false,
      "schemas/lineups.schema.json is removed by S1L"
    );
  });
});

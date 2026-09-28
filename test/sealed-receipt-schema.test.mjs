/**
 * Sealed receipts must match the fixture that test/schema-validation.py
 * validates against schemas/verification.schema.json. If sealVerification
 * changes shape, this fails until the fixture is regenerated and the schema
 * is updated to match.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require(path.join(ROOT, "test/build-sealed-receipt-fixture.cjs"));

describe("sealed receipt fixture", () => {
  it("equals what sealVerification emits today", () => {
    const fixture = JSON.parse(
      readFileSync(path.join(ROOT, "test/fixtures/sealed-receipts.reverify.json"), "utf8"),
    );
    assert.deepEqual(fixture, build());
  });

  it("covers both evidence tiers the bridge emits", () => {
    const { receipts } = build();
    assert.equal(receipts.observed.evidence_tier, "observed");
    assert.equal(receipts.observed.backend_verdict, "VERIFIED");
    assert.equal(receipts.derived.evidence_tier, "derived");
    assert.equal(receipts.derived.status, "INCONCLUSIVE");
    assert.equal(receipts.derived.evidence_engine, "cfg-recovery 1.2.0");
  });
});

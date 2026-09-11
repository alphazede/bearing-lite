import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = path.join(ROOT, "schemas/journey.schema.json");

describe("journey schema (issue #72)", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const journeyProps = schema.properties.journey.properties;
  const leaseSchema = schema.properties.checkout_lease;
  const leaseProps = leaseSchema.properties;

  it("checkout_lease gains released_at and release_reason with stated types", () => {
    assert.ok(leaseProps.released_at, "released_at property must exist");
    assert.equal(leaseProps.released_at.type, "string");
    assert.equal(leaseProps.released_at.format, "date-time");

    assert.ok(leaseProps.release_reason, "release_reason property must exist");
    assert.equal(leaseProps.release_reason.type, "string");
    assert.equal(leaseProps.release_reason.minLength, 1);

    assert.equal(leaseSchema.additionalProperties, false);
  });

  it("if/then requires both released_at and release_reason when state is released", () => {
    assert.ok(leaseSchema.if, "checkout_lease must define an if condition");
    assert.equal(leaseSchema.if.properties?.state?.const, "released");

    assert.ok(leaseSchema.then, "checkout_lease must define a then clause");
    assert.ok(Array.isArray(leaseSchema.then.required));
    assert.deepEqual([...leaseSchema.then.required].sort(), ["release_reason", "released_at"]);
  });

  it("journey.status becomes an enum and deep-equals the expected list", () => {
    assert.equal(journeyProps.status.type, "string");
    assert.deepEqual(journeyProps.status.enum, [
      "planning",
      "implementation",
      "complete",
      "cancelled",
    ]);
  });

  it("a status outside the enum is not in status.enum", () => {
    const validStatuses = journeyProps.status.enum;
    assert.equal(validStatuses.includes("unknown"), false);
    assert.equal(validStatuses.includes("in_progress"), false);
    assert.equal(validStatuses.includes("failed"), false);
    assert.equal(validStatuses.includes(""), false);
  });
});

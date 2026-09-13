import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = readFileSync(
  path.join(ROOT, "skills/bearing-lite/references/profiles.md"),
  "utf8"
);

const ROLES = [
  "Implementer",
  "Light Implementer",
  "Coordinator",
  "Reviewer",
  "Test Engineer",
  "Scribe",
  "Plan Integrator",
  "Systems Modeler",
  "Integration Engineer",
  "Requirements Engineer",
];

describe("Lifecycle profile defaults", () => {
  it("records configurable slice, phase, or lifecycle cadence with approved defaults", () => {
    assert.match(CONFIG, /values `slice`, `phase`, or `lifecycle`/);
    assert.match(CONFIG, /Defaults are `phase`, `phase`,\s+and `lifecycle`/);
    assert.doesNotMatch(CONFIG, /`review_cadence` is `at-end`/);
  });

  it("names every configurable role and never the Orchestrator", () => {
    for (const role of ROLES) {
      assert.match(CONFIG, new RegExp(`\\b${role.replace(" ", "\\s+")}\\b`));
    }
    assert.doesNotMatch(CONFIG, /Trail Boss|Sub-Explorer|trail-boss|sub-explorer/);
    assert.match(CONFIG, /Surveyor, Explorer,\s+Crewmate, Navigator, Park Ranger, and Validator are not profile roles/);
    assert.match(CONFIG, /The Orchestrator is not a configurable role/);
    assert.match(CONFIG, /observed Orchestrator identity/);
    assert.match(CONFIG, /`router_row_ignored`/);
    assert.match(CONFIG, /never a deviation/);
    assert.match(CONFIG, /Never fill agent, model, or reasoning values\s+on the user's behalf/);
  });

  it("profiles.json is the single source; the legacy markdown file is ignored, never created", () => {
    assert.equal(
      existsSync(path.join(ROOT, "skills/bearing-lite/templates/default-role-lineup.md")),
      false,
      "templates/default-role-lineup.md must not ship"
    );
    assert.match(CONFIG, /never read or created/);
    assert.match(CONFIG, /`no_named_profiles`/);
    assert.match(CONFIG, /`MIGRATION_REQUIRED`/);
    const router = readFileSync(path.join(ROOT, "skills/bearing-lite/SKILL.md"), "utf8");
    assert.doesNotMatch(router, /default-role-lineup\.md/);
    assert.match(router, /`no_named_profiles`/);
    assert.match(router, /never a generated file/);
    assert.match(router, /The Orchestrator is observed, not selected/);
    const task = readFileSync(path.join(ROOT, "skills/bearing-lite/templates/task.md"), "utf8");
    assert.doesNotMatch(task, /default-role-lineup\.md/);
    assert.match(task, /observed identity of the session/);
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
    assert.doesNotMatch(readme, /default-role-lineup\.md/);
  });

  it("permits fallback only after verified primary unavailability", () => {
    assert.match(CONFIG, /Only verified primary unavailability activates/);
    assert.match(CONFIG, /OWNER_DECISION_REQUIRED/);
  });

  it("max_assurance_rounds is a fixed Lite rule, not an owner-selected budget", () => {
    const router = readFileSync(
      path.join(ROOT, "skills/bearing-lite/SKILL.md"),
      "utf8"
    );
    assert.match(router, /`max_assurance_rounds` is\s+1/);
    assert.doesNotMatch(CONFIG, /max_assurance_rounds|assurance_rounds/);
    assert.doesNotMatch(CONFIG, /assurance budget|review-round limit/i);
  });

  it("in-flight identities come from the Lifecycle snapshot, not later global defaults", () => {
    const router = readFileSync(
      path.join(ROOT, "skills/bearing-lite/SKILL.md"),
      "utf8"
    );
    assert.match(router, /recorded\s+snapshot is authoritative for this Lifecycle/);
    assert.match(
      router,
      /Later edits to\s+`~\/\.agents\/bearing-lite\/profiles\.json` have no effect on it/
    );
    assert.doesNotMatch(
      CONFIG,
      /overrides the recorded Lifecycle snapshot|live override of an in-flight Lifecycle/i
    );
  });
});

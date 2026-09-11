/** #70 / #73: Map the Route freeze checks. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { checkRoles, verifyDigests, freeze } = require(path.join(ROOT, "hooks/plan-package.cjs"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

const seit = (actor) => ({
  procedures_and_commands: [{ id: "PROC-RERUN", ...(actor ? { actor } : {}) }],
});
const impl = (role) => ({
  waves: [{ slices: [{ id: "S1.10", role, command_ids: ["PROC-RERUN"] }] }],
});

describe("plan-package (#73 actor/role consistency)", () => {
  it("reports a mismatch naming both files, the step, and both values", () => {
    const [finding, ...rest] = checkRoles(seit("Explorer"), impl("Router"));
    assert.equal(rest.length, 0);
    assert.deepEqual(finding, {
      code: "actor_role_mismatch",
      step: "S1.10",
      command_id: "PROC-RERUN",
      seit_actor: "Explorer",
      implementation_role: "Router",
      files: ["seit.json", "implementation.json"],
    });
  });
  it("matching actor and role, or no actor, produce nothing", () => {
    assert.deepEqual(checkRoles(seit("Explorer"), impl("Explorer")), []);
    assert.deepEqual(checkRoles(seit(null), impl("Router")), []);
  });
  it("an unknown command id is a finding", () => {
    assert.deepEqual(checkRoles({ procedures_and_commands: [] }, impl("Router")), [
      { code: "unknown_command_id", step: "S1.10", command_id: "PROC-RERUN" },
    ]);
  });
});

describe("plan-package (#70 embedded digest freeze)", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "plan-package-"));
  const dir = path.join(repo, "docs/plans/x");
  mkdirSync(path.join(repo, ".git"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  const plan = "# plan\n";
  const design = "# design\n";
  writeFileSync(path.join(dir, "plan.md"), plan);
  writeFileSync(path.join(dir, "design.md"), design);
  writeFileSync(
    path.join(dir, "seit.json"),
    JSON.stringify({
      source_baseline: {
        planning_inputs: [
          { path: "docs/plans/x/plan.md", sha256: sha(plan) },
          { path: "docs/plans/x/design.md", sha256: sha(design) },
        ],
      },
      procedures_and_commands: [],
    })
  );
  const seitBytes = readFileSync(path.join(dir, "seit.json"));
  const expectedManifest = sha([sha(plan), sha(design), sha(seitBytes)].join("\n"));
  const impl = (candidate_digest, extra = {}) =>
    writeFileSync(
      path.join(dir, "implementation.json"),
      JSON.stringify({ journey_settings: { planning_review: { candidate_digest }, ...extra } })
    );

  it("fails closed on a missing artifact or candidate digest", () => {
    assert.deepEqual(freeze(path.join(repo, "nowhere")).findings.map((f) => f.code), [
      "missing_artifact",
      "missing_artifact",
    ]);
    impl(undefined);
    assert.deepEqual(verifyDigests(dir).findings, [
      { code: "missing_candidate_digest", actual: expectedManifest },
    ]);
  });
  it("passes with a manifest digest that binds plan, design, and seit.json", () => {
    impl(expectedManifest);
    assert.deepEqual(verifyDigests(dir), { manifest_digest: expectedManifest, findings: [] });
    assert.equal(freeze(dir).outcome, "PASS");
  });
  it("a specification Journey needs an existing SDoc register", () => {
    impl(expectedManifest, { journey_type: "specification", requirement_register: "docs/plans/x/register.md" });
    assert.deepEqual(verifyDigests(dir).findings.map((f) => f.code), ["missing_requirement_register"]);
    writeFileSync(path.join(dir, "register.sdoc"), "[DOCUMENT]\n");
    impl(expectedManifest, { journey_type: "specification", requirement_register: "docs/plans/x/register.sdoc" });
    assert.deepEqual(verifyDigests(dir).findings, []);
  });
  it("fails on an edited seit.json, then on an edited input", () => {
    impl(expectedManifest);
    writeFileSync(path.join(dir, "seit.json"), seitBytes.toString() + "\n");
    assert.deepEqual(freeze(dir).findings.map((f) => f.code), ["candidate_digest_mismatch"]);
    writeFileSync(path.join(dir, "seit.json"), seitBytes);
    writeFileSync(path.join(dir, "plan.md"), plan + "edited\n");
    assert.deepEqual(freeze(dir).findings.map((f) => f.code), ["digest_mismatch", "candidate_digest_mismatch"]);
    assert.equal(freeze(dir).outcome, "FAIL");
  });
});

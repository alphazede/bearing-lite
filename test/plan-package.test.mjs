/** #70 / #73: Map the Route freeze checks. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  const expectedManifest = sha([sha(plan), sha(design)].join("\n"));

  it("passes with a stable manifest digest when every digest matches", () => {
    const result = verifyDigests(dir);
    assert.deepEqual(result, { manifest_digest: expectedManifest, findings: [] });
    assert.equal(freeze(dir).outcome, "PASS");
  });
  it("fails on a wrong candidate_digest, then on an edited input", () => {
    writeFileSync(
      path.join(dir, "implementation.json"),
      JSON.stringify({ journey_settings: { planning_review: { candidate_digest: "0".repeat(64) } } })
    );
    assert.deepEqual(verifyDigests(dir).findings, [
      { code: "candidate_digest_mismatch", recorded: "0".repeat(64), actual: expectedManifest },
    ]);
    writeFileSync(path.join(dir, "plan.md"), plan + "edited\n");
    const codes = freeze(dir).findings.map((f) => f.code);
    assert.deepEqual(codes, ["digest_mismatch", "candidate_digest_mismatch"]);
    assert.equal(freeze(dir).outcome, "FAIL");
  });
});

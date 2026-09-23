import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { evaluatePlanningReview } = require(path.join(ROOT, "hooks/planning-review.cjs"));
const { freeze } = require(path.join(ROOT, "hooks/plan-package.cjs"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function temporary(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "manifest-pin-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const candidate = { candidate_ref: "plan", candidate_revision: "r1", candidate_digest: "d1" };
function passingReview(planDir) {
  return {
    plan_dir: planDir,
    candidate,
    reviewer_slots: [{ slot_id: "slot-a", primary_route_ref: "route-a", fallback_route_refs: [] }],
    round_number: 1,
    completed_rounds: 1,
    receipts: [{ slot_id: "slot-a", selected_route_ref: "route-a", ...candidate, independent: true, findings_isolated: true }],
    aggregation_complete: true,
    aggregated_repairs: 0,
  };
}

test("SEIT-136.01: the manifest projection and rendered HTML both gate review", (t) => {
  const dir = temporary(t);
  const name = "x-dod-manifest.html";
  const html = path.join(dir, name);
  writeFileSync(html, "<!doctype html><title>DoD</title>");
  const review = passingReview(dir);
  assert.deepEqual(evaluatePlanningReview(review), {
    outcome: "NEEDS_MORE_EVIDENCE", reason: "manifest_not_generated",
  });
  rmSync(html);
  review.dod_manifest = { output_name: name };
  assert.deepEqual(evaluatePlanningReview(review), {
    outcome: "NEEDS_MORE_EVIDENCE", reason: "manifest_not_generated",
  });
  writeFileSync(html, "<!doctype html><title>DoD</title>");
  assert.notEqual(evaluatePlanningReview(review).reason, "manifest_not_generated");
});

test("SEIT-136.02: absent manifest returns the exact fail-closed result", (t) => {
  assert.deepEqual(evaluatePlanningReview(passingReview(temporary(t))), {
    outcome: "NEEDS_MORE_EVIDENCE", reason: "manifest_not_generated",
  });
});

function planningStep6() {
  const skill = readFileSync(path.join(ROOT, "skills/planning-and-design/SKILL.md"), "utf8");
  return skill.match(/^6\. [\s\S]*?(?=\n## Return and recovery)/m)?.[0] ?? "";
}

test("SEIT-136.03 and SEIT-136.04(b): review-presentation step cites the enforced guard and reason", () => {
  const step = planningStep6();
  assert.match(step, /hooks\/planning-review\.cjs/);
  assert.match(step, /evaluatePlanningReview/);
  assert.match(step, /manifest_not_generated/);
});

test("SEIT-136.04(a): planning-review is not registered as a host hook", () => {
  const hooks = path.join(ROOT, "hooks");
  const hostFiles = readdirSync(hooks, { recursive: true }).filter((file) => path.basename(file) === "hooks.json");
  assert.ok(hostFiles.length > 0);
  for (const file of hostFiles) {
    assert.doesNotMatch(readFileSync(path.join(hooks, file), "utf8"), /planning-review\.cjs/, file);
  }
});

function packageFixture(t, writeSet) {
  const root = temporary(t);
  const dir = path.join(root, "docs/plans/x");
  const registerPath = "docs/plans/x/register.sdoc";
  const register = "[DOCUMENT]\nUID: R-1\n";
  mkdirSync(path.join(root, ".git"));
  mkdirSync(dir, { recursive: true });
  const put = (rel, text) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(registerPath, register);
  put("docs/plans/x/authority.json", JSON.stringify({ requirement_register: { path: registerPath, sha256: sha(register) } }));
  const plan = "# Plan\n";
  put("docs/plans/x/plan.md", plan);
  const seit = {
    source_baseline: { planning_inputs: [{ path: "docs/plans/x/plan.md", sha256: sha(plan) }] },
    procedures_and_commands: [],
  };
  put("docs/plans/x/seit.json", JSON.stringify(seit));
  const manifestDigest = sha([sha(plan), sha(JSON.stringify(seit))].join("\n"));
  put("docs/plans/x/implementation.json", JSON.stringify({
    journey_settings: {
      journey_type: "specification",
      requirement_register: registerPath,
      planning_review: { candidate_digest: manifestDigest },
    },
    waves: [{ slices: [{ id: "S1", role: "Product Implementer", write_set: writeSet }] }],
  }));
  return { root, dir, registerPath, digest: sha(register), put };
}

function pin(digest) {
  return `# Live register pin\nregister_sha256: ${digest}\n`;
}

function locations(findings) {
  return findings.map((finding) => JSON.stringify(finding).match(/(?:docs\/plans\/x|skills)\/[^" ]+?:\d+/)?.[0] ?? "missing file:line").sort();
}

test("SEIT-135.01: only a stale live pin is reported with file:line", (t) => {
  const live = "docs/plans/x/live.md";
  const gate = "docs/plans/x/evidence/gate-evidence.json";
  const receipt = "docs/plans/x/evidence/2026-09-22-receipt.md";
  const historical = "docs/plans/x/history.json";
  const fixture = packageFixture(t, [live, gate, receipt, historical]);
  const stale = "0".repeat(64);
  fixture.put(live, pin(stale));
  fixture.put(gate, JSON.stringify({ register_sha256: stale }));
  fixture.put(receipt, `2026-09-22 receipt | register_sha256: ${stale}\n`);
  fixture.put(historical, JSON.stringify({ status: "HISTORICAL", register_sha256: stale }));
  const result = freeze(fixture.dir);
  assert.equal(result.outcome, "FAIL");
  assert.deepEqual(locations(result.findings), [`${live}:2`]);
});

test("SEIT-135.02: register guidance requires companion artifacts to cite the authority", () => {
  const grammar = readFileSync(path.join(ROOT, "skills/planning-and-design/references/artifact-grammar.md"), "utf8");
  const register = grammar.split("## Requirements register\n")[1]?.split("\n## Published standards")[0] ?? "";
  assert.match(register, /companion artifacts/i);
  assert.match(register, /authority\.json/);
  assert.match(register, /bound host/i);
  assert.match(register, /by reference/i);
  assert.match(register, /(?:do not copy|instead of carrying)[\s\S]*?register[ -]digest/i);
});

test("SEIT-135.03: the sweep covers a stale pin under skills outside the plan directory", (t) => {
  const live = "skills/live.md";
  const fixture = packageFixture(t, [live]);
  fixture.put(live, pin("0".repeat(64)));
  assert.deepEqual(locations(freeze(fixture.dir).findings), [`${live}:2`]);
});

test("SEIT-135.04: a one-byte register move names every stale pin, then a cascade passes", (t) => {
  const files = ["docs/plans/x/live.md", "skills/live.md"];
  const fixture = packageFixture(t, files);
  for (const file of files) fixture.put(file, pin(fixture.digest));
  assert.deepEqual(freeze(fixture.dir).findings, []);
  const updated = readFileSync(path.join(fixture.root, fixture.registerPath), "utf8") + "X";
  fixture.put(fixture.registerPath, updated);
  const digest = sha(updated);
  fixture.put("docs/plans/x/authority.json", JSON.stringify({ requirement_register: { path: fixture.registerPath, sha256: digest } }));
  assert.deepEqual(locations(freeze(fixture.dir).findings), files.map((file) => `${file}:2`).sort());
  for (const file of files) fixture.put(file, pin(digest));
  assert.deepEqual(freeze(fixture.dir).findings, []);
});

/** #190: one deterministic read of a wave's slices, write sets, and resolved commands. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { waveView } = require(path.join(ROOT, "hooks/plan-package.cjs"));
const HOOK = path.join(ROOT, "hooks/plan-package.cjs");
const PLAN = path.join(ROOT, "docs/plans/2026-09-22-assurance-gate-and-review-flow");

function plan(implementation, seit) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "plan-wave-"));
  writeFileSync(path.join(dir, "implementation.json"), JSON.stringify(implementation));
  writeFileSync(path.join(dir, "seit.json"), JSON.stringify(seit));
  return dir;
}

const SEIT = {
  procedures_and_commands: [
    { id: "CMD-TEST", command: "node --test", pass: "exit 0" },
    { id: "CMD-DIFFCHECK", command: "git diff --check", pass: "exit 0, no output" },
  ],
};

describe("plan-package wave view (#190)", () => {
  it("resolves slice_ids against top-level slices and command ids against seit", () => {
    const view = waveView(PLAN, "Wave 1");
    assert.equal(view.outcome, "PASS");
    assert.deepEqual(view.findings, []);
    assert.equal(view.wave.id, "Wave 1");
    assert.deepEqual(view.slices.map((s) => s.id), ["S1", "S2", "S3", "S4"]);
    const s1 = view.slices[0];
    assert.equal(s1.role, "Test Implementer");
    assert.deepEqual(s1.write_set, ["test/gate-chain.test.mjs"]);
    assert.deepEqual(s1.commands.map((c) => c.id), ["CMD-SUITE", "CMD-PREEXISTING", "CMD-WRITESET"]);
    assert.match(s1.commands[0].command, /node --test/);
    assert.deepEqual(view.exit_commands.map((c) => c.id), ["CMD-PREEXISTING"]);
  });

  it("reads nested waves[].slices and declared exit_command_ids", () => {
    const dir = plan(
      {
        waves: [
          {
            id: "W1",
            exit: "free text naming CMD-TEST is ignored when ids are declared",
            exit_command_ids: ["CMD-DIFFCHECK"],
            slices: [{ id: "S1", role: "Implementer", write_set: ["a.js"], command_ids: ["CMD-TEST"], post_step_command_ids: ["CMD-DIFFCHECK"] }],
          },
        ],
        slices: [],
      },
      SEIT
    );
    const view = waveView(dir, "W1");
    assert.equal(view.outcome, "PASS");
    assert.deepEqual(view.slices[0].commands.map((c) => c.id), ["CMD-TEST", "CMD-DIFFCHECK"]);
    assert.deepEqual(view.exit_commands, [{ id: "CMD-DIFFCHECK", command: "git diff --check", pass: "exit 0, no output" }]);
  });

  it("fails with typed findings for an unknown wave, slice, or command", () => {
    const dir = plan(
      {
        waves: [{ id: "W1", slice_ids: ["S1", "S9"], exit: "CMD-MISSING green" }],
        slices: [{ id: "S1", role: "Implementer", write_set: [], command_ids: ["CMD-NOPE"] }],
      },
      SEIT
    );
    assert.deepEqual(waveView(dir, "W2").findings, [{ code: "wave_not_found", wave_id: "W2" }]);
    const view = waveView(dir, "W1");
    assert.equal(view.outcome, "FAIL");
    assert.deepEqual(view.findings, [
      { code: "wave_slice_unresolved", wave_id: "W1", slice_id: "S9" },
      { code: "unknown_command_id", step: "S1", command_id: "CMD-NOPE" },
      { code: "unknown_command_id", step: "W1", command_id: "CMD-MISSING" },
    ]);
  });

  it("is reachable from the CLI and keeps the freeze form unchanged", () => {
    const ok = spawnSync(process.execPath, [HOOK, "wave", PLAN, "Wave 3"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const view = JSON.parse(ok.stdout);
    assert.deepEqual(view.slices.map((s) => s.id), ["S7"]);
    assert.ok(view.exit_commands.some((c) => c.id === "CMD-DIFFCHECK"));
    const missing = spawnSync(process.execPath, [HOOK, "wave", PLAN, "Wave 9"], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    const usage = spawnSync(process.execPath, [HOOK, "wave", PLAN], { encoding: "utf8" });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /usage: .*wave <plan dir> <wave id>/);
  });

  it("the coordinator skill names the wave read, verbatim launch, blocking wait, and exit order", () => {
    const skill = readFileSync(path.join(ROOT, "skills/coordinator/SKILL.md"), "utf8");
    assert.match(skill, /hooks\/plan-package\.cjs wave <plan dir> <wave id>/);
    assert.match(skill, /Launch with the packet's frozen-route form unchanged/);
    assert.match(skill, /Subscribe to native response\s+notifications; wait and wake on each agent return/);
    assert.match(skill, /Never poll logs, processes,\s+agent status, or worktrees/);
    assert.match(skill, /run exit commands after that last commit/);
    assert.match(skill, /keep raw logs out of commits/i);
  });
});

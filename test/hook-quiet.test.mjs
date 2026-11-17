/**
 * #139 Stop quiet controls.
 * Stop ADVISE / handoff_complete never starts another turn on any shipped
 * host adapter; nothing-to-do closeout and git-sync stay silent; a second
 * stop (stop_hook_active, or Cursor loop_count after a real follow-up)
 * stays quiet.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bindPlan, withTask } from "./task-opt-in-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "test/fixtures/te-hook");
const require = createRequire(import.meta.url);
const host = require(
  path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs")
);
const sync = require(path.join(ROOT, "hooks/git-sync.cjs"));
const HOST_BIN = path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs");

const DIRS = [];
after(() => {
  for (const dir of DIRS) rmSync(dir, { recursive: true, force: true });
});

function tmp(label) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `bearing-quiet-${label}-`));
  DIRS.push(dir);
  return dir;
}

const COMPLETE_PLAN = `# Journey

- journey: Bearing Delivery Lifecycle

### task_id: T1
- outcome: add host mapping
- status: IN_PROGRESS
- assigned_role: Implementer
- next_action: confirm closeout
- candidate_ref: cand-host
- changed_paths: hooks/
- tests: hook-quiet tests
- findings: none
- verdict: PASS
- blocker: none
`;

function writePlan(dir, markdown) {
  writeFileSync(path.join(dir, "plan.md"), markdown);
}

function runBin(bin, payload, args = []) {
  return spawnSync(process.execPath, [bin, ...args], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000,
  });
}

function assertNoContinue(wire, label) {
  assert.equal(wire.decision, undefined, `${label}: no decision block`);
  assert.equal(wire.followup_message, undefined, `${label}: no followup`);
  assert.doesNotMatch(
    JSON.stringify(wire),
    /"decision"\s*:\s*"block"/,
    `${label}: never blocks as continue`
  );
}

describe("stop ADVISE / handoff_complete never requests continuation (#139)", () => {
  // host.cjs closeout: internal response is advisory context, never a block.
  it("bound handoff_complete is advisory context, not a continue request", () => {
    const dir = tmp("complete");
    writePlan(dir, COMPLETE_PLAN);
    const response = host.handle(
      bindPlan({ session_id: "s-complete", cwd: dir, hook_event_name: "Stop" })
    );
    assert.match(
      response.hookSpecificOutput.additionalContext,
      /handoff_complete/
    );
    assert.equal(response.decision, undefined);
  });

  // Claude / Codex / Copilot / Kimi wire: advisory Stop context is omitted.
  it("host.cjs CLI without --host=cursor emits no continue signal", () => {
    const dir = tmp("complete-cli");
    writePlan(dir, COMPLETE_PLAN);
    const result = runBin(
      HOST_BIN,
      bindPlan({ session_id: "s-complete-cli", cwd: dir, hook_event_name: "Stop" })
    );
    assert.equal(result.status, 0, result.stderr);
    const wire = JSON.parse(result.stdout);
    assertNoContinue(wire, "claude/codex wire");
    assert.deepEqual(wire, {}, "advisory Stop context is omitted, not continued");
  });

  // Cursor wire: advice stays additional_context; only decision block follows up.
  it("host.cjs CLI with --host=cursor keeps advice as context, not a follow-up", () => {
    const dir = tmp("complete-cursor");
    writePlan(dir, COMPLETE_PLAN);
    const result = runBin(
      HOST_BIN,
      bindPlan({ session_id: "s-complete-cursor", cwd: dir, hook_event_name: "Stop" }),
      ["--host=cursor"]
    );
    assert.equal(result.status, 0, result.stderr);
    const wire = JSON.parse(result.stdout);
    assertNoContinue(wire, "cursor wire");
    assert.match(wire.additional_context ?? "", /handoff_complete/);
  });
});

describe("nothing-to-do closeout and git-sync stay silent (#139)", () => {
  // A plan alone is never activation authority: unbound Stop is silent.
  it("host.cjs Stop with no current-task binding is silent", () => {
    const dir = tmp("unbound");
    writePlan(dir, COMPLETE_PLAN);
    const response = host.handle({
      session_id: "s-unbound",
      cwd: dir,
      hook_event_name: "Stop",
    });
    assert.deepEqual(response, {});
    const result = runBin(HOST_BIN, {
      session_id: "s-unbound",
      cwd: dir,
      hook_event_name: "Stop",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
  });

  // Bound git-sync with nothing to report prints nothing at all.
  it("git-sync handle on a current checkout is silent", () => {
    const { t, local } = gitFixture();
    try {
      const response = sync.handle(
        withTask({ cwd: local, hook_event_name: "Stop" })
      );
      assert.deepEqual(response, {});
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });
});

describe("second stop stays quiet (#139)", () => {
  it("host.cjs Stop re-entry with stop_hook_active is silent", () => {
    const dir = tmp("reentry");
    writePlan(dir, COMPLETE_PLAN);
    const response = host.handle(
      bindPlan({
        session_id: "s-reentry",
        cwd: dir,
        hook_event_name: "Stop",
        stop_hook_active: true,
      })
    );
    assert.deepEqual(response, {});
  });

  // Cursor signals a re-entry after a real follow-up with loop_count.
  it("host.cjs Cursor stop with loop_count 1 is silent; 0 still speaks", () => {
    const dir = tmp("loop");
    writePlan(dir, COMPLETE_PLAN);
    const first = host.handle(
      bindPlan({ session_id: "s-loop", cwd: dir, hook_event_name: "Stop" })
    );
    assert.match(first.hookSpecificOutput.additionalContext, /handoff_complete/);
    const zero = host.handle(
      bindPlan({
        session_id: "s-loop",
        cwd: dir,
        hook_event_name: "Stop",
        loop_count: 0,
      })
    );
    assert.match(zero.hookSpecificOutput.additionalContext, /handoff_complete/);
    const again = host.handle(
      bindPlan({
        session_id: "s-loop",
        cwd: dir,
        hook_event_name: "Stop",
        loop_count: 1,
      })
    );
    assert.deepEqual(again, {});
    const camel = host.handle(
      bindPlan({
        session_id: "s-loop",
        cwd: dir,
        hook_event_name: "Stop",
        loopCount: 1,
      })
    );
    assert.deepEqual(camel, {});
  });

  it("git-sync Cursor stop with loop_count 1 is silent after speaking once", () => {
    const { t, local } = gitFixture();
    try {
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "ahead"], {
        cwd: local,
        encoding: "utf8",
      });
      const first = sync.handle(
        withTask({ cwd: local, hook_event_name: "Stop" })
      );
      assert.ok(first.hookSpecificOutput?.additionalContext);
      const again = sync.handle({
        cwd: local,
        hook_event_name: "Stop",
        loop_count: 1,
        session_id: "active-test-session",
      });
      assert.deepEqual(again, {});
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// te-host helpers (mirrors test/te-hook-contract.test.mjs: real Git workspace
// plus an installable evaluator double that records calls).
// ---------------------------------------------------------------------------

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function makeWorkspace(label) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `bearing-quiet-te-${label}-`));
  DIRS.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "te-quiet@example.invalid");
  git(dir, "config", "user.name", "Bearing Lite TE Quiet");
  return dir;
}

function writeFile(dir, relative, contents) {
  const target = path.join(dir, relative);
  require("node:fs").mkdirSync(require("node:path").dirname(target), {
    recursive: true,
  });
  writeFileSync(target, contents);
  return target;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

function writeTePlan(dir, task) {
  writeFile(
    dir,
    "PLAN.md",
    `# Journey

- journey: Bearing Delivery Lifecycle

- checkout_lease:
  - journey: J-TE
  - controller: Router
  - repository: alphazede/bearing-lite
  - checkout: ${dir}
  - branch: main
  - candidate_revision: ${task.diff_base}
  - acquired_at: 2026-09-09T00:00:00Z
  - generation: 1
  - state: active

### task_id: ${task.task_id}
- outcome: exercise the TE hook contract
- status: IN_PROGRESS
- assigned_role: ${task.assigned_role}
- role_instance: ${task.role_instance}
- next_action: drive the adapter
- scope: ${task.write_set.join(", ")}
- authority: ${task.authority}
- type: ${task.type}
- required_assurance: none
`
  );
}

function installEvaluator(dir) {
  writeFile(
    dir,
    "skills/test-engineering/hooks/te-evaluator.cjs",
    `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const WS = path.resolve(__dirname, "..", "..", "..");
const CALLS = path.join(WS, "te-calls.json");
const VERDICT = path.join(WS, "te-verdict.json");

function record(fn, request) {
  const calls = fs.existsSync(CALLS)
    ? JSON.parse(fs.readFileSync(CALLS, "utf8"))
    : [];
  calls.push({ fn, request });
  fs.writeFileSync(CALLS, JSON.stringify(calls, null, 2));
  return JSON.parse(fs.readFileSync(VERDICT, "utf8"));
}

module.exports = {
  evaluateTestWrite: (request) => record("evaluateTestWrite", request),
  evaluateCompletion: (request) => record("evaluateCompletion", request),
};
`
  );
  writeFileSync(
    path.join(dir, "te-verdict.json"),
    JSON.stringify({ verdict: "DENY_RECEIPT_REQUIRED", reason: "quiet_deny" })
  );
}

function setVerdict(dir, verdict) {
  writeFileSync(path.join(dir, "te-verdict.json"), JSON.stringify(verdict));
}

function teCalls(dir) {
  const target = path.join(dir, "te-calls.json");
  return existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : [];
}

function envelope(name, workspaceRoot, overrides = {}) {
  const raw = readFileSync(path.join(FIXTURES, name), "utf8");
  return {
    ...JSON.parse(raw.replaceAll("__WORKSPACE__", workspaceRoot)),
    ...overrides,
  };
}

describe("te-host stop never auto-continues except on deny (#139)", () => {
  const teHost = require(path.join(ROOT, "hooks/te-host.cjs"));

  function teWorkspace(label) {
    const dir = makeWorkspace(label);
    installEvaluator(dir);
    writeFile(dir, "src/engine.mjs", "export const engine = 1;\n");
    const base = commitAll(dir, "baseline");
    writeTePlan(dir, {
      task_id: `T-TE-QUIET-${label}`,
      assigned_role: "Product Implementer",
      role_instance: `PC-QUIET-${label}`,
      write_set: ["src/"],
      authority: "AUTH-EMV-001",
      type: "product",
      diff_base: base,
    });
    writeFile(dir, "src/engine.mjs", "export const engine = 2;\n");
    return dir;
  }

  // Control: a first-pass completion deny is the documented continue request.
  it("te-host first-pass Stop deny is the only continue request", () => {
    const dir = teWorkspace("control");
    const response = teHost.handle(envelope("claude-stop.json", dir), {
      selected: true,
      host: "claude-code",
    });
    assert.equal(response.hookSpecificOutput.verdict, "DENY_RECEIPT_REQUIRED");
    assert.equal(teHost.toWire(response).decision, "block");
  });

  // A stop allow is silent: no decision, no follow-up on any TE host.
  it("te-host Stop allow is silent on every native host", () => {
    const dir = teWorkspace("allow");
    setVerdict(dir, { verdict: "ALLOW", reason: "quiet_allow" });
    for (const hostName of ["claude-code", "codex", "copilot"]) {
      const response = teHost.handle(envelope("claude-stop.json", dir), {
        selected: true,
        host: hostName,
      });
      assert.deepEqual(teHost.toWire(response), {}, hostName);
    }
  });

  // Native hosts re-evaluate on re-entry: stopping twice must not skip the
  // blocking completion gate. Only Copilot re-entry terminates quietly.
  it("te-host Claude and Codex stop re-entry re-runs the evaluator and blocks again", () => {
    const dir = teWorkspace("reentry");
    for (const hostName of ["claude-code", "codex"]) {
      const before = teCalls(dir).length;
      const response = teHost.handle(
        envelope("claude-stop.json", dir, { stop_hook_active: true }),
        { selected: true, host: hostName }
      );
      assert.equal(
        teCalls(dir).length,
        before + 1,
        `${hostName} must re-evaluate on re-entry`
      );
      assert.equal(response.hookSpecificOutput.verdict, "DENY_RECEIPT_REQUIRED", hostName);
      assert.equal(teHost.toWire(response).decision, "block", hostName);
    }
  });

  it("te-host Copilot stop re-entry is quiet and never re-runs the evaluator", () => {
    const dir = teWorkspace("reentry-copilot");
    const before = teCalls(dir).length;
    const response = teHost.handle(
      envelope("claude-stop.json", dir, { stop_hook_active: true }),
      { selected: true, host: "copilot" }
    );
    assert.equal(teCalls(dir).length, before, "copilot must not re-enter");
    assert.notEqual(response.decision, "block", "copilot");
    assert.deepEqual(teHost.toWire(response), {}, "copilot");
  });
});

// ---------------------------------------------------------------------------
// Local git fixture for git-sync controls.
// ---------------------------------------------------------------------------
function gitFixture() {
  const t = tmp("git");
  const origin = path.join(t, "origin");
  const local = path.join(t, "local");
  execFileSync("git", ["init", "-q", "-b", "main", origin], { encoding: "utf8" });
  execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"],
    { cwd: origin, encoding: "utf8" }
  );
  execFileSync("git", ["clone", "-q", origin, local], { encoding: "utf8" });
  return { t, origin, local };
}

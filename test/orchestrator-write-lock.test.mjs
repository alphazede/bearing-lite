import { boundHook, withTask } from "./task-opt-in-fixture.mjs";
/**
 * #112 Orchestrator write-set lock: the Orchestrator controller (no role or
 * BEARING_ROLE=orchestrator) authors final plan/design and assembly but cannot
 * write specialist-owned content such as SEIT (BEARING_ROLE=integration_test) or
 * the requirements library. Detection cases below use seit.json as the
 * Orchestrator-denied artifact.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const LOCK = path.join(ROOT, "hooks/orchestrator-write-lock.cjs");

describe("#112 orchestrator write-set lock", () => {
  it("lets the bound Orchestrator refresh exact source hashes and case bindings before review", (t) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "mechanical-binding-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    const lock = boundHook(require(LOCK));
    mkdirSync(path.join(cwd, "docs/coe"), { recursive: true });
    const plan = "docs/plans/example";
    mkdirSync(path.join(cwd, plan), { recursive: true });
    writeFileSync(path.join(cwd, "task-opt-in.md"),
      `# Active task\n### task_id: hook-test-task\n- status: IN_PROGRESS\n- plan_dir: ${plan}\n`);
    const register = "docs/coe/register.sdoc";
    const design = `${plan}/design.md`;
    const seit = `${plan}/seit.json`;
    const oldHash = "0".repeat(64);
    const content = "# Approved design\n";
    const newHash = createHash("sha256").update(content).digest("hex");
    writeFileSync(path.join(cwd, design), content);
    writeFileSync(path.join(cwd, register), "[REQUIREMENT]\nUID: REQ-1\nVERIFICATION_CASE_ID: pending\n[/REQUIREMENT]\n");
    writeFileSync(path.join(cwd, plan, "implementation.json"), JSON.stringify({ journey_settings: { requirement_register: register } }));
    writeFileSync(path.join(cwd, seit), JSON.stringify({
      source_baseline: { planning_inputs: [{ path: design, sha256: oldHash }] },
      proof_cases: [{ id: "CASE-1", requirement_id: "REQ-1" }, { id: "CASE-2", requirement_id: "REQ-2" }],
    }, null, 2));

    const decision = (file, before, after, role = "orchestrator") => lock.handle({
      cwd, role, hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-${before}\n+${after}\n*** End Patch` },
    }, { host: "codex", role }).hookSpecificOutput.verdict;
    const hashLine = (digest) => `        "sha256": "${digest}"`;
    assert.equal(decision(seit, hashLine(oldHash), hashLine(newHash)), "ALLOW");
    assert.equal(decision(register, "VERIFICATION_CASE_ID: pending", "VERIFICATION_CASE_ID: CASE-1"), "ALLOW");
    assert.equal(decision(seit, hashLine(oldHash), hashLine("1".repeat(64))), "DENY_DISPATCH");
    assert.equal(decision(seit, `        "path": "${design}",`, '        "path": "plan.md",'), "DENY_DISPATCH");
    assert.equal(decision(register, "VERIFICATION_CASE_ID: pending", "VERIFICATION_CASE_ID: CASE-2"), "DENY_DISPATCH");
    assert.equal(decision(seit, hashLine(oldHash), hashLine(newHash), "reviewer"), "DENY_DISPATCH");

    writeFileSync(path.join(cwd, ".bearing-round.lock"), JSON.stringify({ plan_dir: ".", candidate: "frozen" }));
    assert.equal(decision(seit, hashLine(oldHash), hashLine(newHash)), "DENY_DISPATCH");
    assert.equal(decision(register, "VERIFICATION_CASE_ID: pending", "VERIFICATION_CASE_ID: CASE-1"), "DENY_DISPATCH");
  });
  it("ships hooks/orchestrator-write-lock.cjs", () => {
    assert.ok(existsSync(LOCK), "hooks/orchestrator-write-lock.cjs must exist");
  });

  it("refuses an Orchestrator session writing seit.json", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({
      paths: ["docs/plans/example/seit.json"],
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /integration_test/);
    assert.match(String(result.dispatch), /BEARING_ROLE=integration_test/);
  });

  it("allows the Orchestrator controller to author final design and the technical plan (F1)", () => {
    const lock = boundHook(require(LOCK));
    for (const file of ["docs/plans/example/design.md", "docs/plans/example/example-technical-plan.md"]) {
      assert.equal(lock.evaluate({ paths: [file] }).verdict, "ALLOW", file);
      assert.equal(lock.evaluate({ role: "orchestrator", paths: [file] }).verdict, "ALLOW", file);
      const child = lock.evaluate({ agent_id: "child-1", paths: [file] });
      assert.equal(child.verdict, "DENY_DISPATCH", `role-less subagent: ${file}`);
      assert.doesNotMatch(String(child.reason), /planning_and_design|BEARING_ROLE=orchestrator/);
    }
  });

  it("allows BEARING_ROLE=integration_test to write seit.json", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({
      role: "integration_test",
      paths: ["docs/plans/example/seit.json"],
    });
    assert.equal(result.verdict, "ALLOW");
  });

  it("refuses the retired separate Planning and Design author identity (F1/F7)", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({ role: "planning_and_design", paths: ["docs/plans/example/design.md"] });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /retired_role:planning_and_design/);
    assert.doesNotMatch(String(result.dispatch), /Dispatch skills\/planning-and-design/);
  });

  it("tells the Orchestrator to dispatch a planning delta for specialist findings", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({
      paths: ["seit.json"],
      finding: true,
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /delta/i);
  });

  it("activation records write_lock present or absent", () => {
    const lock = boundHook(require(path.join(ROOT, "hooks/activation.cjs")));
    assert.equal(lock.evaluate({ write_lock: "absent" }).write_lock, "absent");
    assert.equal(lock.evaluate({ write_lock: "present" }).write_lock, "present");
  });

  it("denies a pathless apply_patch body that names seit.json", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({
      tool_input: { patch: "*** Update File: seit.json\n@@\n+x\n" },
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /integration_test/);
  });

  it("denies file/filename keys that name a locked artifact", () => {
    const lock = boundHook(require(LOCK));
    for (const key of ["file", "filename"]) {
      const result = lock.evaluate({ tool_input: { [key]: "seit.json" } });
      assert.equal(result.verdict, "DENY_DISPATCH", key);
    }
  });

  it("allows read-only inspection commands against a locked path (#158)", () => {
    const lock = boundHook(require(LOCK));
    for (const command of [
      "cat docs/plans/example/seit.json",
      "sha256sum docs/plans/example/seit.json",
      "grep -n lifecycle docs/plans/example/seit.json",
      "git diff -- docs/plans/example/seit.json",
      "git show HEAD:docs/plans/example/seit.json",
      "sed -n '1,40p' docs/plans/example/seit.json",
      "cp docs/plans/example/seit.json /tmp/review-copy.md",
    ]) {
      const result = lock.evaluate({ tool_input: { command } });
      assert.equal(result.verdict, "ALLOW", command);
    }
  });

  it("allows prose that merely mentions a locked artifact (#158)", () => {
    const lock = boundHook(require(LOCK));
    const result = lock.evaluate({
      tool_input: { file_path: "/tmp/notes.md", content: "see seit.json for the plan" },
    });
    assert.equal(result.verdict, "ALLOW");
  });

  it("still denies genuine shell writes to a locked path (#158)", () => {
    const lock = boundHook(require(LOCK));
    for (const command of [
      "echo x > docs/plans/example/seit.json",
      "printf x >> seit.json",
      "cat /tmp/a | tee seit.json",
      "rm seit.json",
      "mv /tmp/a seit.json",
      "truncate -s 0 seit.json",
      "sed -i s/a/b/ seit.json",
    ]) {
      const result = lock.evaluate({ tool_input: { command } });
      assert.equal(result.verdict, "DENY_DISPATCH", command);
    }
  });

  it("names the build in a refusal (#129)", () => {
    const lock = boundHook(require(LOCK));
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const denied = lock.evaluate({ tool_input: { file_path: "seit.json" } });
    assert.equal(denied.verdict, "DENY_DISPATCH");
    assert.match(String(denied.reason), /bearing-lite v\d+\.\d+\.\d+/);
    assert.ok(String(denied.reason).includes(`bearing-lite v${pkg.version}`));

    const saved = process.env.BEARING_ROLE;
    delete process.env.BEARING_ROLE;
    try {
      const response = lock.handle({
        hook_event_name: "PreToolUse",
        role: "orchestrator",
        tool_input: { file_path: "seit.json" },
      });
      assert.equal(response.hookSpecificOutput.verdict, "DENY_DISPATCH");
      assert.equal(response.hookSpecificOutput.version, pkg.version);
      assert.ok(
        String(response.hookSpecificOutput.permissionDecisionReason).includes(
          `bearing-lite v${pkg.version}`
        )
      );
    } finally {
      if (saved === undefined) delete process.env.BEARING_ROLE;
      else process.env.BEARING_ROLE = saved;
    }
  });

  it("allows prose mention of a governed file while denying a genuine write (#129)", () => {
    const lock = boundHook(require(LOCK));
    const prose = lock.evaluate({
      tool_input: { file_path: "/tmp/notes.md", content: "see seit.json for the plan" },
    });
    assert.equal(prose.verdict, "ALLOW", "prose mention must not count as a write");
    const write = lock.evaluate({
      tool_input: { command: "echo x > docs/plans/example/seit.json" },
    });
    assert.equal(write.verdict, "DENY_DISPATCH", "genuine shell write stays denied");
  });

  it("allows #132 cases that only name a locked artifact", () => {
    const lock = boundHook(require(LOCK));
    const cases = [
      { tool_input: { command: "python3 tools/coe/lint-plan-spec.py" } },
      { tool_input: { command: "BEARING_ROLE=planning_and_design python3 tools/coe/lint-plan-spec.py" } },
      { tool_input: { command: "gh pr create --body-file /tmp/pr.md" } },
      { tool_input: { command: "cat <<EOF > /tmp/packet.md\nDo not edit implementation.json\nEOF" } },
      { tool_input: { file_path: "/tmp/packet.md", content: "see seit.json" } },
      { tool_input: { command: "grep lifecycle docs/plans/example/seit.json | wc -l" } },
    ];
    for (const input of cases) {
      assert.equal(lock.evaluate(input).verdict, "ALLOW", JSON.stringify(input.tool_input));
    }
  });

  it("still denies genuine writes named in #132", () => {
    const lock = boundHook(require(LOCK));
    for (const command of [
      "echo x > docs/plans/example/seit.json",
      "tee docs/coe/index.md </dev/null",
    ]) {
      assert.equal(lock.evaluate({ tool_input: { command } }).verdict, "DENY_DISPATCH", command);
    }
  });

  it("defers Orchestrator plan-dir writes while a review round is frozen (#119)", () => {
    const lock = boundHook(require(LOCK));
    const dir = path.join(os.tmpdir(), "bl-round-" + process.pid);
    mkdirSync(path.join(dir, "docs/plans/x"), { recursive: true });
    writeFileSync(
      path.join(dir, ".bearing-round.lock"),
      JSON.stringify({ candidate: "cand-1", plan_dir: "docs/plans/x" })
    );
    try {
      const denied = lock.evaluate({
        cwd: dir,
        tool_input: { file_path: path.join(dir, "docs/plans/x", "notes.md") },
      });
      assert.equal(denied.verdict, "DENY_DISPATCH");
      assert.match(String(denied.reason), /frozen_candidate/);
      const allowed = lock.evaluate({
        cwd: dir,
        tool_input: { file_path: path.join(dir, "scratch.md") },
      });
      assert.equal(allowed.verdict, "ALLOW");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handle honors envelope role and still denies Orchestrator", () => {
    const lock = boundHook(require(LOCK));
    const saved = process.env.BEARING_ROLE;
    delete process.env.BEARING_ROLE;
    try {
      const allowed = lock.handle({
        hook_event_name: "PreToolUse",
        assigned_role: "integration_test",
        tool_input: { file_path: "seit.json" },
      });
      assert.equal(allowed.hookSpecificOutput.verdict, "ALLOW");

      const denied = lock.handle({
        hook_event_name: "PreToolUse",
        role: "orchestrator",
        tool_input: { file_path: "seit.json" },
      });
      assert.equal(denied.hookSpecificOutput.verdict, "DENY_DISPATCH");
    } finally {
      if (saved === undefined) delete process.env.BEARING_ROLE;
      else process.env.BEARING_ROLE = saved;
    }
  });
});

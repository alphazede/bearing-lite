/**
 * #112 Orchestrator write-set lock: deny planning writes without BEARING_ROLE;
 * allow them when BEARING_ROLE=planning_and_design.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const LOCK = path.join(ROOT, "hooks/orchestrator-write-lock.cjs");

describe("#112 orchestrator write-set lock", () => {
  it("ships hooks/orchestrator-write-lock.cjs", () => {
    assert.ok(existsSync(LOCK), "hooks/orchestrator-write-lock.cjs must exist");
  });

  it("refuses an Orchestrator session writing design.md", () => {
    const lock = require(LOCK);
    const result = lock.evaluate({
      paths: ["docs/plans/example/design.md"],
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /planning_and_design/);
    assert.match(String(result.dispatch), /BEARING_ROLE=planning_and_design/);
  });

  it("allows BEARING_ROLE=planning_and_design to write design.md", () => {
    const lock = require(LOCK);
    const result = lock.evaluate({
      role: "planning_and_design",
      paths: ["docs/plans/example/design.md"],
    });
    assert.equal(result.verdict, "ALLOW");
  });

  it("tells the Orchestrator to dispatch a planning delta for specialist findings", () => {
    const lock = require(LOCK);
    const result = lock.evaluate({
      paths: ["design.md"],
      finding: true,
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /delta/i);
  });

  it("activation records write_lock present or absent", () => {
    const lock = require(path.join(ROOT, "hooks/activation.cjs"));
    assert.equal(lock.evaluate({ write_lock: "absent" }).write_lock, "absent");
    assert.equal(lock.evaluate({ write_lock: "present" }).write_lock, "present");
  });

  it("denies a pathless apply_patch body that names design.md", () => {
    const lock = require(LOCK);
    const result = lock.evaluate({
      tool_input: { patch: "*** Update File: design.md\n@@\n+x\n" },
    });
    assert.equal(result.verdict, "DENY_DISPATCH");
    assert.match(String(result.reason), /planning_and_design/);
  });

  it("denies file/filename keys that name a locked artifact", () => {
    const lock = require(LOCK);
    for (const key of ["file", "filename"]) {
      const result = lock.evaluate({ tool_input: { [key]: "design.md" } });
      assert.equal(result.verdict, "DENY_DISPATCH", key);
    }
  });

  it("allows read-only inspection commands against a locked path (#158)", () => {
    const lock = require(LOCK);
    for (const command of [
      "cat docs/plans/example/design.md",
      "sha256sum docs/plans/example/design.md",
      "grep -n lifecycle docs/plans/example/design.md",
      "git diff -- docs/plans/example/design.md",
      "git show HEAD:docs/plans/example/design.md",
      "sed -n '1,40p' docs/plans/example/design.md",
      "cp docs/plans/example/design.md /tmp/review-copy.md",
    ]) {
      const result = lock.evaluate({ tool_input: { command } });
      assert.equal(result.verdict, "ALLOW", command);
    }
  });

  it("allows prose that merely mentions a locked artifact (#158)", () => {
    const lock = require(LOCK);
    const result = lock.evaluate({
      tool_input: { file_path: "/tmp/notes.md", content: "see design.md for the plan" },
    });
    assert.equal(result.verdict, "ALLOW");
  });

  it("still denies genuine shell writes to a locked path (#158)", () => {
    const lock = require(LOCK);
    for (const command of [
      "echo x > docs/plans/example/design.md",
      "printf x >> design.md",
      "cat /tmp/a | tee design.md",
      "rm design.md",
      "mv /tmp/a design.md",
      "truncate -s 0 design.md",
      "sed -i s/a/b/ design.md",
    ]) {
      const result = lock.evaluate({ tool_input: { command } });
      assert.equal(result.verdict, "DENY_DISPATCH", command);
    }
  });

  it("names the build in a refusal (#129)", () => {
    const lock = require(LOCK);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const denied = lock.evaluate({ tool_input: { file_path: "design.md" } });
    assert.equal(denied.verdict, "DENY_DISPATCH");
    assert.match(String(denied.reason), /bearing-lite v\d+\.\d+\.\d+/);
    assert.ok(String(denied.reason).includes(`bearing-lite v${pkg.version}`));

    const saved = process.env.BEARING_ROLE;
    delete process.env.BEARING_ROLE;
    try {
      const response = lock.handle({
        hook_event_name: "PreToolUse",
        role: "orchestrator",
        tool_input: { file_path: "design.md" },
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
    const lock = require(LOCK);
    const prose = lock.evaluate({
      tool_input: { file_path: "/tmp/notes.md", content: "see design.md for the plan" },
    });
    assert.equal(prose.verdict, "ALLOW", "prose mention must not count as a write");
    const write = lock.evaluate({
      tool_input: { command: "echo x > docs/plans/example/design.md" },
    });
    assert.equal(write.verdict, "DENY_DISPATCH", "genuine shell write stays denied");
  });

  it("allows #132 cases that only name a locked artifact", () => {
    const lock = require(LOCK);
    const cases = [
      { tool_input: { command: "python3 tools/coe/lint-plan-spec.py" } },
      { tool_input: { command: "BEARING_ROLE=planning_and_design python3 tools/coe/lint-plan-spec.py" } },
      { tool_input: { command: "gh pr create --body-file /tmp/pr.md" } },
      { tool_input: { command: "cat <<EOF > /tmp/packet.md\nDo not edit implementation.json\nEOF" } },
      { tool_input: { file_path: "/tmp/packet.md", content: "see design.md" } },
      { tool_input: { command: "grep lifecycle docs/plans/example/design.md | wc -l" } },
    ];
    for (const input of cases) {
      assert.equal(lock.evaluate(input).verdict, "ALLOW", JSON.stringify(input.tool_input));
    }
  });

  it("still denies genuine writes named in #132", () => {
    const lock = require(LOCK);
    for (const command of [
      "echo x > docs/plans/example/design.md",
      "tee docs/coe/index.md </dev/null",
    ]) {
      assert.equal(lock.evaluate({ tool_input: { command } }).verdict, "DENY_DISPATCH", command);
    }
  });

  it("defers Orchestrator plan-dir writes while a review round is frozen (#119)", () => {
    const lock = require(LOCK);
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
    const lock = require(LOCK);
    const saved = process.env.BEARING_ROLE;
    delete process.env.BEARING_ROLE;
    try {
      const allowed = lock.handle({
        hook_event_name: "PreToolUse",
        assigned_role: "planning_and_design",
        tool_input: { file_path: "design.md" },
      });
      assert.equal(allowed.hookSpecificOutput.verdict, "ALLOW");

      const denied = lock.handle({
        hook_event_name: "PreToolUse",
        role: "orchestrator",
        tool_input: { file_path: "design.md" },
      });
      assert.equal(denied.hookSpecificOutput.verdict, "DENY_DISPATCH");
    } finally {
      if (saved === undefined) delete process.env.BEARING_ROLE;
      else process.env.BEARING_ROLE = saved;
    }
  });
});

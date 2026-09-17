/**
 * #112 Orchestrator write-set lock: deny planning writes without BEARING_ROLE;
 * allow them when BEARING_ROLE=planning_and_design.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

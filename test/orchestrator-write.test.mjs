import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const lock = require(path.join(root, "hooks/orchestrator-write-lock.cjs"));

function withoutBearingRole(run) {
  const saved = process.env.BEARING_ROLE;
  delete process.env.BEARING_ROLE;
  try {
    run();
  } finally {
    if (saved === undefined) delete process.env.BEARING_ROLE;
    else process.env.BEARING_ROLE = saved;
  }
}

test("AC-146.03 orchestrator-workspace", () => {
  const result = lock.evaluate({
    role: "orchestrator",
    paths: ["docs/plans/example/workspace.md"],
  });
  assert.equal(result.verdict, "ALLOW", "Orchestrator owns workspace.md writes");
});

test("AC-146.01 orchestrator-repository-map", () => {
  const result = lock.evaluate({
    role: "orchestrator",
    paths: ["docs/plans/example/repository-map.md"],
  });
  assert.equal(result.verdict, "ALLOW", "Orchestrator owns repository-map.md writes");
});

test("AC-146.01 architectural-alignment ownership text", () => {
  const skill = readFileSync(path.join(root, "skills/architectural-alignment/SKILL.md"), "utf8");
  const text = skill.replace(/\s+/g, " ");
  assert.match(
    text,
    /Orchestrator.{0,80}(?:own(?:s|ed|ership)?|writ(?:es|e|able)|creat(?:es|e)|updat(?:es|e)).{0,100}`workspace\.md`.{0,50}`repository-map\.md`/i,
    "Architectural Alignment must state Orchestrator ownership of both files"
  );
  assert.doesNotMatch(skill, /If you are the Orchestrator, dispatch this; do not execute it\./);
});

test("AC-146.02 envelope-subagent-role", () => {
  withoutBearingRole(() => {
    const response = lock.handle({
      hook_event_name: "PreToolUse",
      agent_id: "child-1",
      assigned_role: "planning_and_design",
      tool_input: { file_path: "docs/plans/example/seit.json" },
    });
    assert.equal(response.hookSpecificOutput.verdict, "ALLOW");
  });
});

test("AC-146.03 host-without-role", () => {
  withoutBearingRole(() => {
    const response = lock.handle({
      hook_event_name: "PreToolUse",
      agent_id: "child-1",
      tool_input: { file_path: "docs/plans/example/seit.json" },
    });
    const output = response.hookSpecificOutput;
    assert.equal(output.verdict, "DENY_DISPATCH");
    assert.match(
      output.permissionDecisionReason,
      /separate process.{0,100}BEARING_ROLE/i,
      "role-less subagent must receive the separate-process BEARING_ROLE fallback"
    );
    assert.doesNotMatch(output.permissionDecisionReason, /Orchestrator cannot write/i);
  });
});

test("AC-146.02 remaining locked artifact guard", () => {
  const result = lock.evaluate({
    role: "orchestrator",
    paths: ["docs/plans/example/seit.json"],
  });
  assert.equal(result.verdict, "DENY_DISPATCH");
  assert.equal(result.owner, "planning_and_design");
});

test("W2-F4 role-less subagent cannot write architectural-alignment artifacts", () => {
  withoutBearingRole(() => {
    for (const name of ["workspace.md", "repository-map.md"]) {
      const response = lock.handle({
        hook_event_name: "PreToolUse", agent_id: "child-1",
        tool_input: { file_path: `docs/plans/example/${name}` },
      });
      assert.equal(response.hookSpecificOutput.verdict, "DENY_DISPATCH", name);
      assert.match(response.hookSpecificOutput.permissionDecisionReason, /separate process.{0,100}BEARING_ROLE/i);
    }
  });
});

test("W2-F5 subagent assigned_role overrides inherited process role", () => {
  withoutBearingRole(() => {
    const response = lock.handle({
      hook_event_name: "PreToolUse", agent_id: "child-1", assigned_role: "planning_and_design",
      tool_input: { file_path: "docs/plans/example/seit.json" },
    }, { role: "orchestrator" });
    assert.equal(response.hookSpecificOutput.verdict, "ALLOW");
  });
});

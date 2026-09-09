/**
 * Verified Claude Code / Codex host mapping.
 * Derives Bearing fields from cwd Markdown; translates outcomes to host JSON;
 * never maps policy to process status.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const host = require(path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs"));
const HOST_BIN = path.join(ROOT, "hooks/com.anthropic.claude-code/host.cjs");

const READY_PLAN = `# Journey

- journey: Explorer Journey
- review_cadence: at-end

### task_id: T1
- outcome: add host mapping
- status: IN_PROGRESS
- assigned_role: crewmate
- depends_on: []
- next_action: write host adapter
- scope: hooks/
- authority: S7
- required_assurance: none
`;

const INCOMPLETE_PLAN = `# Notes

### task_id: T9
- outcome: still proposing
- status: PROPOSED
- assigned_role: unassigned
- depends_on: []
- next_action: <smallest concrete next step>
`;

const COMPLETE_PLAN = `# Journey

- journey: Explorer Journey
- review_cadence: at-end

### task_id: T1
- outcome: add host mapping
- status: IN_PROGRESS
- assigned_role: crewmate
- depends_on: []
- next_action: confirm closeout
- scope: hooks/
- authority: S7
- required_assurance: none
- candidate_ref: cand-host
- changed_paths: hooks/
- tests: host-mapping tests
- findings: none
- verdict: PASS
- blocker: none
`;

const INTENT_AS_RECEIPT_PLAN = `# Journey

- journey: Explorer Journey
- review_cadence: at-end

### task_id: T1
- outcome: add host mapping
- status: IN_PROGRESS
- assigned_role: crewmate
- depends_on: []
- next_action: confirm closeout
- scope: hooks/
- authority: S7
- required_assurance: none
- candidate_ref: cand-host
- changed_paths: hooks/
- tests: host-mapping tests
- findings: none
- blocker: none
`;

function assertQuietSuccess(response) {
  assert.notEqual(response.decision, "block");
  assert.equal(response.reason, undefined);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /additionalContext/);
  assert.doesNotMatch(serialized, /handoff_incomplete/);
  assert.doesNotMatch(serialized, /"decision"\s*:\s*"block"/);
}

function writePlan(dir, markdown, filename = "PLAN.md") {
  writeFileSync(path.join(dir, filename), markdown);
}

function runHost(payload) {
  return spawnSync(process.execPath, [HOST_BIN], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("verified host mapping", () => {
  /** @type {string} */
  let tmp;

  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "bearing-lite-host-"));
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("keeps the SessionStart activation and Stop closeout handlers on host.cjs", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "hooks/hooks.json"), "utf8"));
    assert.ok(!manifest.hooks.PostToolUse);
    for (const event of ["SessionStart", "Stop"]) {
      const handlers = manifest.hooks[event].flatMap((entry) => entry.hooks);
      const activationOrCloseout = handlers.filter((command) =>
        command.args?.some((arg) => arg.endsWith("com.anthropic.claude-code/host.cjs"))
      );
      assert.equal(activationOrCloseout.length, 1, event);
      assert.equal(activationOrCloseout[0].type, "command");
      assert.equal(activationOrCloseout[0].command, "node");
      assert.deepEqual(activationOrCloseout[0].args, [
        "${CLAUDE_PLUGIN_ROOT}/hooks/com.anthropic.claude-code/host.cjs",
      ]);
    }
  });

  it("registers TE on PreToolUse, Stop, and SubagentStop through te-host.cjs", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "hooks/hooks.json"), "utf8"));
    for (const event of ["PreToolUse", "Stop", "SubagentStop"]) {
      assert.ok(
        manifest.hooks[event],
        `hooks.json must register ${event} for the TE classes (ROUTER-EMV-003-001)`
      );
      const handlers = manifest.hooks[event].flatMap((entry) => entry.hooks);
      const te = handlers.filter((command) =>
        command.args?.some((arg) => arg.endsWith("hooks/te-host.cjs"))
      );
      assert.equal(te.length, 1, `${event} must route to hooks/te-host.cjs`);
      assert.equal(te[0].command, "node");
    }
    // Stop-only registration is not child enforcement; SubagentStop is its own
    // handler, not an alias of Stop.
    assert.notEqual(manifest.hooks.SubagentStop, manifest.hooks.Stop);
    const preToolUse = manifest.hooks.PreToolUse[0];
    assert.match(
      String(preToolUse.matcher),
      /Write|Edit|MultiEdit|apply_patch|Bash/,
      "PreToolUse must match the write family"
    );
  });

  it("maps host events on the original adapter to activation or closeout only", () => {
    assert.equal(host.classForEvent("SessionStart"), "activation");
    assert.equal(host.classForEvent("sessionStart"), "activation");
    assert.equal(host.classForEvent("session_start"), "activation");
    assert.equal(host.classForEvent("Stop"), "closeout");
    assert.equal(host.classForEvent("stop"), "closeout");
    // The activation/closeout adapter owns no TE class. `te-host.cjs` maps the
    // TE events; this adapter is not rewritten to fake TE coverage.
    assert.equal(host.classForEvent("PreToolUse"), null);
    assert.equal(host.classForEvent("PostToolUse"), null);
    assert.equal(host.classForEvent("beforeShellExecution"), null);
  });

  it("te-host.cjs is the mapped class for the TE write and completion events", () => {
    const teHostPath = path.join(ROOT, "hooks/te-host.cjs");
    assert.ok(
      existsSync(teHostPath),
      "hooks/te-host.cjs must exist (ROUTER-EMV-003-001 exact_write_sets.Lite_product)"
    );
    const teHost = require(teHostPath);
    for (const event of ["PreToolUse", "preToolUse", "beforeShellExecution"]) {
      assert.equal(teHost.classForEvent(event), "te_test_write", event);
    }
    for (const event of ["Stop", "stop", "SubagentStop", "subagentStop"]) {
      assert.equal(teHost.classForEvent(event), "te_completion", event);
    }
    // Unmapped stays unmapped on both adapters.
    for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse"]) {
      assert.equal(teHost.classForEvent(event), null, event);
    }
  });

  it("accepts Grok/Cursor camelCase session envelopes", () => {
    const cwd = path.join(tmp, "camel");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const response = host.handle({
      sessionId: "s-camel",
      hookEventName: "sessionStart",
      cwd,
      workspaceRoot: cwd,
    });
    assert.equal(response.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(response.hookSpecificOutput.additionalContext, /context_ready/);
  });

  it("keeps Cursor camelCase sessionStart and stop on the activation adapter", () => {
    const cursorHooks = JSON.parse(
      readFileSync(path.join(ROOT, "hooks/com.cursor/hooks.json"), "utf8")
    );
    assert.ok(!cursorHooks.hooks.PreToolUse, "Cursor uses camelCase event names");
    assert.match(cursorHooks.hooks.sessionStart[0].command, /host\.cjs/);
    assert.match(cursorHooks.hooks.stop[0].command, /host\.cjs/);
  });

  it("adds Cursor write-time TE hooks without claiming a hard completion deny", () => {
    const cursorHooks = JSON.parse(
      readFileSync(path.join(ROOT, "hooks/com.cursor/hooks.json"), "utf8")
    );
    for (const event of ["preToolUse", "beforeShellExecution"]) {
      assert.ok(
        cursorHooks.hooks[event],
        `Cursor must register ${event} for te_test_write (ROUTER-EMV-003-001)`
      );
      assert.match(cursorHooks.hooks[event][0].command, /te-host\.cjs/, event);
    }
    // Cursor write-time deny may exist. Cursor `stop` `followup_message` is not
    // a hard completion block, and Cursor child stop is not a hard deny; the
    // manifest must not register either as one.
    assert.ok(
      !cursorHooks.hooks.subagentStop,
      "Cursor subagentStop must not be advertised as a hard completion deny"
    );
    const stopCommands = cursorHooks.hooks.stop.map((entry) => entry.command);
    assert.ok(
      stopCommands.every((command) => !/te-host\.cjs/.test(command)),
      "Cursor stop must not be registered as a native TE completion deny"
    );
    assert.doesNotMatch(
      JSON.stringify(cursorHooks),
      /followup_message/,
      "followup_message is not a completion block"
    );
  });

  it("derives plan_present, role, and next_action from visible Markdown", () => {
    const cwd = path.join(tmp, "ready");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const derived = host.deriveContext(cwd);
    assert.equal(derived.plan_present, true);
    assert.equal(derived.router_invoked, true);
    assert.equal(derived.assigned_role, "crewmate");
    assert.equal(derived.next_action_known, true);
    assert.equal(derived.next_action, "write host adapter");
  });

  it("does not invent router_invoked or role from a host tool event", () => {
    const cwd = path.join(tmp, "empty");
    mkdirSync(cwd);
    const derived = host.deriveContext(cwd);
    assert.equal(derived.plan_present, false);
    assert.equal(derived.router_invoked, false);
    assert.equal(derived.assigned_role, undefined);
    assert.equal(derived.next_action_known, false);

    const response = host.handle({
      session_id: "s1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd,
      hook_event_name: "SessionStart",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const context = response.hookSpecificOutput.additionalContext;
    assert.match(context, /ADVISE/);
    assert.match(context, /context_incomplete/);
    assert.doesNotMatch(context, /context_ready/);
    assert.notEqual(response.decision, "block");
  });

  it("treats template placeholders as missing context", () => {
    const cwd = path.join(tmp, "placeholders");
    mkdirSync(cwd);
    writePlan(cwd, INCOMPLETE_PLAN);
    const derived = host.deriveContext(cwd);
    assert.equal(derived.plan_present, true);
    assert.equal(derived.router_invoked, false);
    assert.equal(derived.assigned_role, undefined);
    assert.equal(derived.next_action_known, false);
  });

  it("unfilled Journey-settings placeholders do not mark the Router invoked", () => {
    const cwd = path.join(tmp, "journey-settings-placeholder");
    mkdirSync(cwd);
    writePlan(
      cwd,
      `# Journey template copy\n\n- journey: <Explorer Journey | Expedition>\n- review_cadence: at-end\n- choice_basis: <owner-confirmed recommendation and reason>\n- lineup_snapshot: <named active, standby, and unused role instances>\n`
    );
    const derived = host.deriveContext(cwd);
    assert.equal(derived.router_invoked, false);
    assert.equal(derived.journey, null);
    assert.equal(derived.plan_present, false);
  });

  it("SessionStart with a ready plan advises context_ready", () => {
    const cwd = path.join(tmp, "session-ready");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const response = host.handle({
      session_id: "s2",
      cwd,
      hook_event_name: "SessionStart",
    });
    assert.equal(response.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(response.hookSpecificOutput.additionalContext, /context_ready/);
    assert.equal(response.decision, undefined);
  });

  it("Stop is advisory closeout and never requests protected completion", () => {
    const cwd = path.join(tmp, "stop");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const response = host.handle({
      session_id: "s3",
      cwd,
      hook_event_name: "Stop",
    });
    assert.equal(response.hookSpecificOutput.hookEventName, "Stop");
    assert.match(response.hookSpecificOutput.additionalContext, /closeout/);
    assert.doesNotMatch(response.hookSpecificOutput.additionalContext, /protected_completion/);
    assert.notEqual(response.decision, "block");
  });

  it("unmapped host events fail open as UNAVAILABLE without blocking", () => {
    const response = host.handle({
      cwd: tmp,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
    });
    assert.match(response.hookSpecificOutput.additionalContext, /UNAVAILABLE/);
    assert.match(response.hookSpecificOutput.additionalContext, /unmapped_host_event/);
    assert.notEqual(response.decision, "block");
  });

  it("malformed host input is UNAVAILABLE, never fabricated BLOCK", () => {
    for (const raw of ["{not-json", 42, ["array"]]) {
      const response = host.handle(raw);
      assert.match(String(response.hookSpecificOutput.additionalContext), /UNAVAILABLE/);
      assert.notEqual(response.decision, "block");
    }
  });

  it("CLI adapter exits 0 and prints host JSON for a Claude SessionStart event", () => {
    const cwd = path.join(tmp, "cli");
    mkdirSync(cwd);
    const result = runHost({
      session_id: "s4",
      transcript_path: "/tmp/t.jsonl",
      cwd,
      hook_event_name: "SessionStart",
      tool_name: "Write",
      tool_input: { file_path: "x.md" },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(parsed.hookSpecificOutput.additionalContext, /ADVISE|UNAVAILABLE/);
    assert.notEqual(parsed.decision, "block");
  });

  it("CLI adapter exits 0 on empty stdin instead of using host exit 2", () => {
    const result = spawnSync(process.execPath, [HOST_BIN], {
      input: "",
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.match(parsed.hookSpecificOutput.additionalContext, /UNAVAILABLE/);
  });

  it("Stop re-entry with stop_hook_active does not request another continuation", () => {
    const cwd = path.join(tmp, "stop-reentry");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const payload = {
      session_id: "abc123",
      transcript_path: "/tmp/transcript.jsonl",
      cwd,
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "I've completed the refactoring. Here's a summary...",
    };
    const response = host.handle(payload);
    assertQuietSuccess(response);

    const result = runHost(payload);
    assert.equal(result.status, 0, result.stderr);
    assertQuietSuccess(JSON.parse(result.stdout));
  });

  it("SubagentStop re-entry with stop_hook_active does not request another continuation", () => {
    const cwd = path.join(tmp, "subagent-reentry");
    mkdirSync(cwd);
    writePlan(cwd, READY_PLAN);
    const response = host.handle({
      session_id: "abc123",
      cwd,
      hook_event_name: "SubagentStop",
      stop_hook_active: true,
      agent_id: "def456",
      agent_type: "Explore",
    });
    assertQuietSuccess(response);
  });

  it("Stop with no Journey, plan, active task, or assigned role terminates quietly", () => {
    const cwd = path.join(tmp, "empty-stop");
    mkdirSync(cwd);
    const response = host.handle({
      session_id: "s-empty-stop",
      transcript_path: "/tmp/transcript.jsonl",
      cwd,
      hook_event_name: "Stop",
    });
    assertQuietSuccess(response);
    assert.doesNotMatch(JSON.stringify(response), /closeout/);
  });

  it("active incomplete Journey still reports the specific missing handoff fields", () => {
    const cwd = path.join(tmp, "incomplete-journey");
    mkdirSync(cwd);
    writePlan(cwd, INCOMPLETE_PLAN);
    const response = host.handle({
      session_id: "s-incomplete",
      cwd,
      hook_event_name: "Stop",
    });
    const context = response.hookSpecificOutput.additionalContext;
    assert.match(context, /handoff_incomplete:/);
    assert.match(context, /verdict/);
    assert.match(context, /candidate_ref/);
    assert.match(context, /changed_paths/);
    assert.match(context, /tests/);
    assert.match(context, /findings/);
    assert.notEqual(response.decision, "block");
  });

  it("task-block outcome intent cannot complete the compact receipt", () => {
    const cwd = path.join(tmp, "intent-as-receipt");
    mkdirSync(cwd);
    writePlan(cwd, INTENT_AS_RECEIPT_PLAN);
    const derived = host.deriveContext(cwd);
    assert.equal(derived.active_task.outcome, "add host mapping");
    assert.equal(derived.active_task.verdict, undefined);

    const response = host.handle({
      session_id: "s-intent-as-receipt",
      cwd,
      hook_event_name: "Stop",
    });
    const context = response.hookSpecificOutput.additionalContext;
    assert.match(context, /handoff_incomplete:verdict/);
    assert.doesNotMatch(context, /handoff_complete/);
    assert.notEqual(response.decision, "block");
  });

  it("present but invalid verdict is not reported as a missing field", () => {
    const cwd = path.join(tmp, "invalid-verdict");
    mkdirSync(cwd);
    writePlan(cwd, INTENT_AS_RECEIPT_PLAN.replace(
      "- findings: none\n- blocker: none",
      "- findings: none\n- verdict: add host mapping\n- blocker: none"
    ));
    const response = host.handle({
      session_id: "s-invalid-verdict",
      cwd,
      hook_event_name: "Stop",
    });
    const context = response.hookSpecificOutput.additionalContext;
    assert.match(context, /handoff_invalid:verdict/);
    assert.match(context, /PASS/);
    assert.doesNotMatch(context, /handoff_incomplete:verdict/);
    assert.doesNotMatch(context, /handoff_complete/);
    assert.notEqual(response.decision, "block");
  });

  it("active complete Journey preserves documented advisory closeout", () => {
    const cwd = path.join(tmp, "complete-journey");
    mkdirSync(cwd);
    writePlan(cwd, COMPLETE_PLAN);
    const derived = host.deriveContext(cwd);
    assert.equal(derived.active_task.outcome, "add host mapping");
    assert.equal(derived.active_task.verdict, "PASS");
    const response = host.handle({
      session_id: "s-complete",
      cwd,
      hook_event_name: "Stop",
    });
    const context = response.hookSpecificOutput.additionalContext;
    assert.match(context, /closeout/);
    assert.match(context, /handoff_complete/);
    assert.doesNotMatch(context, /handoff_incomplete/);
    assert.doesNotMatch(context, /protected_completion/);
    assert.notEqual(response.decision, "block");
  });

  it("first-pass Stop discovers a journey-marker-only plan", () => {
    const cwd = path.join(tmp, "journey-marker-only");
    mkdirSync(cwd);
    writePlan(
      cwd,
      `# Lease-first notes

- journey: Explorer Journey
`
    );
    const derived = host.deriveContext(cwd);
    assert.equal(derived.plan_present, true);
    assert.equal(derived.router_invoked, true);
    assert.equal(derived.assigned_role, undefined);
    assert.equal(derived.active_task, null);

    const response = host.handle({
      session_id: "s-journey-marker",
      cwd,
      hook_event_name: "Stop",
    });
    assert.match(response.hookSpecificOutput.additionalContext, /closeout|ADVISE/);
    assert.notEqual(response.decision, "block");
  });

  it("first-pass Stop discovers a checkout_lease-only plan", () => {
    const cwd = path.join(tmp, "lease-only");
    mkdirSync(cwd);
    writePlan(
      cwd,
      `# Visible lease

- checkout_lease:
  - journey: J-A
  - controller: Router
  - repository: alphazede/bearing-lite
  - checkout: wt-main
  - branch: main
  - candidate_revision: 4040dfe
  - acquired_at: 2026-08-18T00:00:00Z
  - generation: 1
  - state: active
`
    );
    const derived = host.deriveContext(cwd);
    assert.equal(derived.plan_present, true);
    assert.equal(derived.router_invoked, true);
    assert.equal(derived.active_task, null);

    const response = host.handle({
      session_id: "s-lease-only",
      cwd,
      hook_event_name: "Stop",
    });
    assert.match(response.hookSpecificOutput.additionalContext, /closeout|ADVISE/);
    assert.notEqual(response.decision, "block");
  });

  it("mapping.md documents quiet Stop cases and first-pass discoverable Journey context", () => {
    const mapping = readFileSync(
      path.join(ROOT, "hooks/com.anthropic.claude-code/mapping.md"),
      "utf8"
    );
    assert.match(mapping, /stop_hook_active/);
    assert.match(mapping, /quiet success/i);
    assert.match(mapping, /no discoverable Journey/);
    assert.match(mapping, /discoverable Journey/);
    assert.match(mapping, /additionalContext/);
    assert.match(mapping, /checkout_lease/);
    assert.match(mapping, /journey marker/);
    assert.match(mapping, /Receipt `verdict`/);
    assert.match(mapping, /task `outcome` is approved intent/);
  });

  it("mapping.md documents the TE classes and stays honest about unsupported hosts", () => {
    const mapping = readFileSync(
      path.join(ROOT, "hooks/com.anthropic.claude-code/mapping.md"),
      "utf8"
    );
    // TE classes are documented where native events exist.
    assert.match(mapping, /te_test_write/);
    assert.match(mapping, /te_completion/);
    assert.match(mapping, /PreToolUse/);
    assert.match(mapping, /SubagentStop/);
    assert.match(mapping, /beforeShellExecution/);
    // Unmapped events stay UNAVAILABLE.
    assert.match(mapping, /unmapped[\s\S]{0,80}UNAVAILABLE/i);

    // Host honesty. Grok / Codex / Claude Code carry the mapped child stop.
    for (const host of ["Grok", "Codex", "Claude Code"]) {
      assert.match(mapping, new RegExp(host), host);
    }
    // Cursor: no native completion or child-stop deny claim.
    const cursorRow = mapping
      .split("\n")
      .find((line) => /^\|\s*Cursor\b/.test(line) && /te_completion|completion/i.test(line));
    assert.ok(
      cursorRow,
      "mapping.md must carry a Cursor TE completion row stating UNAVAILABLE"
    );
    // Cursor write-time deny may be claimed. Completion and child stop may not:
    // a `stop` `followup_message` is not a hard completion block.
    const cursorCompletionCells = cursorRow
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell) => /completion|stop/i.test(cell));
    assert.ok(cursorCompletionCells.length > 0, "Cursor completion cell missing");
    for (const cell of cursorCompletionCells) {
      assert.match(cell, /UNAVAILABLE/, cell);
      assert.doesNotMatch(
        cell,
        /\bnative\b|hard (?:block|deny)/i,
        `Cursor completion must not be advertised as a hard native block: ${cell}`
      );
    }
    assert.doesNotMatch(
      cursorRow,
      /followup_message/i,
      "followup_message is not a hard completion block"
    );
    // Kimi / Pi / AGY / DeepCode remain UNAVAILABLE for native TE blocking.
    for (const host of ["Kimi", "Pi", "AGY", "DeepCode"]) {
      const row = mapping
        .split("\n")
        .find((line) => new RegExp(`^\\|\\s*${host}\\b`).test(line) && /te_|TE\b/.test(line));
      assert.ok(row, `mapping.md must state TE support for ${host}`);
      assert.match(row, /UNAVAILABLE/, host);
    }
  });
});

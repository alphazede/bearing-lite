/**
 * Alphazedehq#636: AGY root hooks.json and adapter contract.
 * Tests the root hooks.json manifest, AGY protojson input/output translation,
 * and every Bearing hook mapped to an AGY event (SessionStart, PreToolUse, Stop).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_HOOKS = path.join(ROOT, "hooks.json");
const AGY_HOST = path.join(ROOT, "hooks/com.google.antigravity/host.cjs");

const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("BEARING_"))
);

function runAgyHook(target, payload, extraEnv = {}, cwd = ROOT) {
  const r = spawnSync(process.execPath, [AGY_HOST, target], {
    cwd,
    env: { ...CLEAN_ENV, ...extraEnv },
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(r.error, undefined, r.error?.message);
  assert.equal(r.status, 0, `${target} exited ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(
    Object.hasOwn(out, "hookSpecificOutput"),
    false,
    `AGY rejects hookSpecificOutput via protojson (${target}): ${r.stdout}`
  );
  return { out, stderr: r.stderr };
}

function bindTask(dir, sessionId, extraLines = "") {
  writeFileSync(
    path.join(dir, "PLAN.md"),
    `# Journey\n\n- journey: Bearing Delivery Lifecycle\n- review_cadence: at-end\n\n- bearing_session: ${JSON.stringify({
      owner_requested: true,
      session_id: sessionId,
      task_id: "T-AGY-1",
    })}\n\n### task_id: T-AGY-1\n- outcome: verify agy hooks\n- status: IN_PROGRESS\n- assigned_role: Orchestrator\n- depends_on: []\n- next_action: run checks\n- scope: hooks/\n- authority: S1\n- required_assurance: none\n${extraLines}`
  );
}

describe("Alphazedehq#636 AGY root hooks.json and adapter", () => {
  let tmp;

  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "bearing-agy-hooks-"));
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("ships root hooks.json in AGY JSONHookSpec format with all 7 mapped Bearing hooks", () => {
    assert.equal(existsSync(ROOT_HOOKS), true, "root hooks.json must exist");
    const raw = readFileSync(ROOT_HOOKS, "utf8");
    assert.doesNotMatch(raw, /\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/, "AGY commands must use relative ./hooks/... paths");
    assert.doesNotMatch(raw, /\/home\/|\/Users\/|[A-Za-z]:\\/, "root hooks.json must stay free of host paths");

    const parsed = JSON.parse(raw);
    assert.equal(typeof parsed, "object");
    assert.equal(parsed.hooks, undefined, "top-level keys must be named JSONHookSpec entries, not Claude 'hooks'");
    assert.equal(parsed.description, undefined, "top-level keys must not include string 'description'");

    const validEvents = new Set(["SessionStart", "PreInvocation", "PostInvocation", "Stop", "PreToolUse", "PostToolUse"]);
    const commands = [];
    for (const [name, spec] of Object.entries(parsed)) {
      assert.equal(typeof spec, "object", name);
      for (const [event, entries] of Object.entries(spec)) {
        if (event === "enabled") continue;
        assert.ok(validEvents.has(event), `${name}: unsupported AGY event ${event}`);
        assert.ok(Array.isArray(entries), `${name}.${event} must be an array`);
        if (event === "PreToolUse" || event === "PostToolUse") {
          for (const group of entries) {
            assert.equal(typeof group.matcher, "string", `${name}.${event} group needs matcher`);
            assert.ok(Array.isArray(group.hooks) && group.hooks.length > 0);
            for (const h of group.hooks) {
              assert.match(h.command, /^node \.\/hooks\/com\.google\.antigravity\/host\.cjs \S+$/);
              commands.push({ event, matcher: group.matcher, command: h.command });
            }
          }
        } else {
          for (const h of entries) {
            assert.equal(h.hooks, undefined, `${name}.${event} must use flat handler array`);
            assert.match(h.command, /^node \.\/hooks\/com\.google\.antigravity\/host\.cjs \S+$/);
            commands.push({ event, command: h.command });
          }
        }
      }
    }

    assert.equal(commands.length, 7, "all 7 Bearing hooks on SessionStart/PreToolUse/Stop must be mapped");
    const has = (event, target) => commands.some((c) => c.event === event && c.command.endsWith(` ${target}`));
    assert.ok(has("SessionStart", "activation"));
    assert.ok(has("PreToolUse", "assurance-dispatch"));
    assert.ok(has("PreToolUse", "te-write"));
    assert.ok(has("PreToolUse", "orchestrator-write-lock"));
    assert.ok(has("Stop", "closeout"));
    assert.ok(has("Stop", "te-completion"));
    assert.ok(has("Stop", "git-sync"));
  });

  it("SessionStart activation translates AGY conversationId and returns injectSteps", () => {
    const ws = path.join(tmp, "session-start");
    mkdirSync(ws);
    // Unbound work stays quiet `{}`.
    const quiet = runAgyHook("activation", {
      conversationId: "conv-unbound",
      cwd: ws,
      workspacePaths: [ws],
      hookEventName: "SessionStart",
    });
    assert.deepEqual(quiet.out, {});

    bindTask(ws, "conv-bound");
    const bound = runAgyHook("activation", {
      conversationId: "conv-bound",
      cwd: ws,
      workspacePaths: [ws],
      hookEventName: "SessionStart",
    });
    assert.ok(Array.isArray(bound.out.injectSteps) && bound.out.injectSteps.length === 1);
    const msg = bound.out.injectSteps[0]?.systemMessage?.systemMessage;
    assert.match(String(msg), /context_ready/);
    assert.match(String(msg), /write_lock: present/);
  });

  it("PreToolUse orchestrator-write-lock denies locked writes via AGY decision=deny", () => {
    const ws = path.join(tmp, "write-lock");
    mkdirSync(ws);
    bindTask(ws, "conv-lock");

    // Ordinary file allowed.
    const allowed = runAgyHook("orchestrator-write-lock", {
      conversationId: "conv-lock",
      cwd: ws,
      hookEventName: "PreToolUse",
      toolCall: { id: "c1", name: "write_file", args: { Path: "README.md", Content: "ok" } },
    });
    assert.deepEqual(allowed.out, { decision: "allow" });

    // Locked planning file denied via write_file, edit_file, and run_command.
    for (const toolCall of [
      { id: "c2", name: "write_file", args: { Path: "seit.json", Content: "{}" } },
      { id: "c3", name: "edit_file", args: { Path: "seit.json", Target: "a", Replacement: "b" } },
      { id: "c4", name: "run_command", args: { CommandLine: "echo '{}' > seit.json" } },
    ]) {
      const denied = runAgyHook("orchestrator-write-lock", {
        conversationId: "conv-lock",
        cwd: ws,
        hookEventName: "PreToolUse",
        toolCall,
      });
      assert.equal(denied.out.decision, "deny", toolCall.name);
      assert.match(String(denied.out.reason), /integration_test/);
    }
  });

  it("PreToolUse assurance-dispatch allows safe/bound slots and denies undeclared bound launches", () => {
    const ws = path.join(tmp, "dispatch");
    mkdirSync(ws);
    const declaration = {
      waves: [{ id: "W1" }],
      journey_settings: {
        lifecycle_id: "J-AGY",
        assurance_dispatch: {
          slots: [
            {
              id: "slot-1",
              kind: "review",
              group: "g1",
              unit_id: "W1",
              candidate: "cand-1",
              scope: "s1",
              tool_name: "run_command",
              tool_input: { CommandLine: "echo review" },
            },
          ],
        },
      },
    };
    const record = {
      journey: "J-AGY",
      units: [{ unit_kind: "wave", unit_id: "W1", assurance_rounds: 0, assurance_repairs: 0, receipts: [{ kind: "gate_chain", unit_id: "W1", verdict: "PASS" }] }],
      dispatch_log: [],
      amendments: [],
    };
    const declPath = path.join(ws, "implementation.json");
    const recPath = path.join(ws, "task-record.json");
    writeFileSync(declPath, JSON.stringify(declaration));
    writeFileSync(recPath, JSON.stringify(record));
    const declSha = createHash("sha256").update(readFileSync(declPath)).digest("hex");
    bindTask(
      ws,
      "conv-disp",
      `- assurance_dispatch: ${JSON.stringify({ declaration_path: "implementation.json", declaration_sha256: declSha, task_record_path: "task-record.json", journey: "J-AGY" })}\n`
    );

    const safeEdit = runAgyHook("assurance-dispatch", {
      conversationId: "conv-disp",
      cwd: ws,
      hookEventName: "PreToolUse",
      toolCall: { id: "c1", name: "write_file", args: { Path: "src/a.js", Content: "x" } },
    });
    assert.deepEqual(safeEdit.out, { decision: "allow" });

    const allowedSlot = runAgyHook("assurance-dispatch", {
      conversationId: "conv-disp",
      cwd: ws,
      hookEventName: "PreToolUse",
      toolCall: { id: "c2", name: "run_command", args: { CommandLine: "echo review" } },
    });
    assert.deepEqual(allowedSlot.out, { decision: "allow" });

    const deniedExtra = runAgyHook("assurance-dispatch", {
      conversationId: "conv-disp",
      cwd: ws,
      hookEventName: "PreToolUse",
      toolCall: { id: "c3", name: "run_command", args: { CommandLine: "echo undeclared" } },
    });
    assert.equal(deniedExtra.out.decision, "deny");
  });

  it("PreToolUse te-write and Stop te-completion enforce native AGY deny/continue and respect continuationActive", () => {
    const ws = path.join(tmp, "te");
    mkdirSync(path.join(ws, "skills/test-engineering/hooks"), { recursive: true });
    spawnSync("git", ["init", "-q"], { cwd: ws });
    writeFileSync(
      path.join(ws, "skills/test-engineering/hooks/te-evaluator.cjs"),
      `module.exports = {
        evaluateTestWrite: () => ({ verdict: "DENY_ROUTE_TO_TE", reason: "te_write_blocked" }),
        evaluateCompletion: () => ({ verdict: "DENY_RECEIPT_REQUIRED", reason: "te_receipt_needed" }),
      };\n`
    );
    const preDeny = runAgyHook(
      "te-write",
      {
        conversationId: "conv-te",
        cwd: ws,
        hookEventName: "PreToolUse",
        toolCall: { id: "c1", name: "write_file", args: { Path: "test/a.test.js", Content: "x" } },
      },
      { BEARING_TEST_ENGINEERING_SELECTED: "1" }
    );
    assert.equal(preDeny.out.decision, "deny");
    assert.match(String(preDeny.out.reason), /te_write_blocked/);

    const stopContinue = runAgyHook(
      "te-completion",
      {
        conversationId: "conv-te",
        cwd: ws,
        hookEventName: "Stop",
        continuationActive: false,
      },
      { BEARING_TEST_ENGINEERING_SELECTED: "1" }
    );
    assert.equal(stopContinue.out.decision, "continue");
    assert.match(String(stopContinue.out.reason), /te_receipt_needed/);

    const stopReentry = runAgyHook(
      "te-completion",
      {
        conversationId: "conv-te",
        cwd: ws,
        hookEventName: "Stop",
        continuationActive: true,
      },
      { BEARING_TEST_ENGINEERING_SELECTED: "1" }
    );
    assert.deepEqual(stopReentry.out, {});
  });

  it("Stop closeout and git-sync stay quiet on AGY and handle malformed input safely", () => {
    const ws = path.join(tmp, "stop-quiet");
    mkdirSync(ws);
    bindTask(ws, "conv-stop");

    const closeoutRes = runAgyHook("closeout", {
      conversationId: "conv-stop",
      cwd: ws,
      hookEventName: "Stop",
      continuationActive: false,
    });
    assert.deepEqual(closeoutRes.out, {});

    const gitSyncRes = runAgyHook("git-sync", {
      conversationId: "conv-stop",
      cwd: ws,
      hookEventName: "Stop",
      continuationActive: false,
    });
    assert.deepEqual(gitSyncRes.out, {});

    const malformed = runAgyHook("activation", "{bad-json");
    assert.deepEqual(malformed.out, {});
  });

  it("docs/harness-compatibility.md and mapping.md record AGY hooks as supported", () => {
    const compat = readFileSync(path.join(ROOT, "docs/harness-compatibility.md"), "utf8");
    const mapping = readFileSync(path.join(ROOT, "hooks/com.anthropic.claude-code/mapping.md"), "utf8");
    assert.match(mapping, /\|\s*AGY\s*\|[^\n]*hooks\.json[^\n]*\|\s*partial\s*\|/);
    assert.match(compat, /\|\s*AGY, `plugin install` from a copied payload\s*\|\s*PASS[^\n]*\|\s*PASS[^\n]*\|\s*PASS/);
  });
});

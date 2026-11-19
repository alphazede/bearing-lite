#!/usr/bin/env node
"use strict";

/**
 * Verified host adapter (CONTRACT-HOOK-01, CONTRACT-CLIENT-01).
 *
 * Claude Code, Codex, Grok Build, Cursor, and Kimi Code deliver session
 * events. This adapter derives only the Bearing fields that are visible in
 * the project plan, then calls the portable class evaluators. It never
 * fabricates BLOCK from a missing field.
 *
 * Coverage is partial: activation and closeout are executable; transition and
 * protected_action stay procedural. Always exit 0 (RISK-12 / RISK-20). Host
 * blocking, if ever required, is JSON-only — never process status.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const activation = require("../activation.cjs");
const { binding } = require("../task-binding.cjs");
const closeout = require("../closeout.cjs");
const cursorStop = require("../cursor-stop.cjs");
const decisionAdapter = require("../decision-adapter.cjs");

const HOST = "com.anthropic.claude-code";
const COVERAGE = Object.freeze({
  activation: Object.freeze({ executable: true, procedural: true }),
  closeout: Object.freeze({ executable: true, procedural: true }),
  transition: Object.freeze({ executable: false, procedural: true }),
  protected_action: Object.freeze({ executable: false, procedural: true }),
});
// Bound assurance is the executable subset of transition; other transition checks stay procedural.
const ASSURANCE_DISPATCH_COVERAGE = require("../assurance-dispatch.cjs").HOST_SUPPORT;

const MAX_FILES = 20;
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 3;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  ".cache",
  "target",
  "vendor",
  ".venv",
  "venv",
  "skills",
  "hooks",
  "test",
  "tests",
  "templates",
]);

const TASK_MARK = /(?:^|\n)###\s*task_id:\s*\S+/;
const TASK_LINE = /^###\s*task_id:\s*(\S+)\s*$/;
const FIELD_LINE =
  /^-\s*(assigned_role|next_action|status|required_assurance|blocker|evidence|candidate_ref|scope|authority|outcome|verdict|depends_on|receiving_role|plan_ref|role|subject|changed_paths|tests|findings):\s*(.*)$/;
// Matches both the plan-level Journey type and the lease-nested Journey
// identity; either non-placeholder value marks the Router as invoked.
const JOURNEY_LINE = /^\s*-\s*journey:\s*(.+)$/i;
const LEASE_MARK = /^\s*-\s*checkout_lease:/m;

const ACTIVATION_EVENTS = new Set([
  "SessionStart",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "CwdChanged",
  "SubagentStart",
]);
const CLOSEOUT_EVENTS = new Set(["Stop", "SubagentStop", "SessionEnd"]);
const STOP_CONTINUATION_EVENTS = new Set(["Stop", "SubagentStop"]);

const EVENT_ALIASES = Object.freeze({
  sessionstart: "SessionStart",
  userpromptsubmit: "UserPromptSubmit",
  beforesubmitprompt: "UserPromptSubmit",
  userpromptexpansion: "UserPromptExpansion",
  cwdchanged: "CwdChanged",
  subagentstart: "SubagentStart",
  stop: "Stop",
  subagentstop: "SubagentStop",
  sessionend: "SessionEnd",
  pretooluse: "PreToolUse",
  posttooluse: "PostToolUse",
  beforeshellexecution: "PreToolUse",
  afterfileedit: "PostToolUse",
});

/**
 * Normalize Claude, Codex, Grok, Cursor, and Kimi event names.
 * @param {unknown} name
 */
function canonicalizeEvent(name) {
  if (typeof name !== "string" || !name.trim()) return "";
  const compact = name.trim().replace(/[_-]/g, "").toLowerCase();
  return EVENT_ALIASES[compact] || name.trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlaceholder(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "unassigned" || /^<[^>]+>$/.test(trimmed);
}

function presentString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || isPlaceholder(trimmed)) return undefined;
  return trimmed;
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (err) {
    const code = err && err.code;
    if (code === "EAGAIN" || code === "EOF") return "";
    throw err;
  }
}

function rankMarkdown(name) {
  const n = name.toLowerCase();
  if (n === "plan.md" || n === "progress.md") return 0;
  if (n.includes("plan")) return 1;
  if (n.includes("implementation") || n.includes("progress")) return 2;
  return 5;
}

function walkMarkdown(root) {
  const out = [];
  function walk(dir, depth) {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const files = [];
    const dirs = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") && entry.name !== ".agents") continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) dirs.push(entry.name);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        files.push(entry.name);
      }
    }
    files.sort((a, b) => rankMarkdown(a) - rankMarkdown(b) || a.localeCompare(b));
    for (const name of files) {
      if (out.length >= MAX_FILES) return;
      out.push(path.join(dir, name));
    }
    dirs.sort((a, b) => {
      if (a === "docs") return -1;
      if (b === "docs") return 1;
      if (a === "plans") return -1;
      if (b === "plans") return 1;
      return a.localeCompare(b);
    });
    for (const name of dirs) {
      walk(path.join(dir, name), depth + 1);
    }
  }
  walk(root, 0);
  return out;
}

function parsePlanMarkdown(text) {
  const tasks = [];
  let journey = null;
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const journeyMatch = line.match(JOURNEY_LINE);
    if (journeyMatch) {
      const value = presentString(journeyMatch[1]);
      if (value) journey = value;
    }
    const taskMatch = line.match(TASK_LINE);
    if (taskMatch) {
      if (current) tasks.push(current);
      current = { task_id: taskMatch[1] };
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(FIELD_LINE);
    if (fieldMatch) {
      const value = presentString(fieldMatch[2]);
      if (value !== undefined) current[fieldMatch[1]] = value;
    }
  }
  if (current) tasks.push(current);
  return { tasks, journey };
}

/**
 * Derive Bearing domain fields from visible Markdown in cwd.
 * Does not invent router_invoked, assigned_role, or next_action.
 * @param {string} cwd
 */
function deriveContext(cwd, bound) {
  if (bound) {
    const task = bound.task;
    const journey = parsePlanMarkdown(bound.raw).journey;
    return { plan_present: true, router_invoked: Boolean(journey), assigned_role: presentString(task.assigned_role),
      next_action: presentString(task.next_action), next_action_known: Boolean(presentString(task.next_action)), active_task: task, journey };
  }
  const files = walkMarkdown(cwd);
  const allTasks = [];
  let journey = null;
  let planPresent = false;
  for (const file of files) {
    let text;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const parsed = parsePlanMarkdown(text);
    const hasAssignedRole = /^-\s*assigned_role:/m.test(text);
    const hasLease = LEASE_MARK.test(text);
    if (!TASK_MARK.test(text) && !hasAssignedRole && !parsed.journey && !hasLease) {
      continue;
    }
    planPresent = true;
    if (parsed.journey) journey = parsed.journey;
    for (const task of parsed.tasks) allTasks.push(task);
  }

  const active =
    allTasks.find((task) => {
      const status = presentString(task.status);
      return status && status !== "COMPLETE" && status !== "CANCELLED";
    }) ||
    allTasks[0] ||
    null;

  const assignedRole = active ? presentString(active.assigned_role) : undefined;
  const nextAction = active ? presentString(active.next_action) : undefined;

  return {
    plan_present: planPresent,
    router_invoked: Boolean(journey),
    assigned_role: assignedRole,
    next_action: nextAction,
    next_action_known: Boolean(nextAction),
    active_task: active,
    journey,
  };
}

function classForEvent(eventName) {
  const canonical = canonicalizeEvent(eventName);
  if (ACTIVATION_EVENTS.has(canonical)) return "activation";
  if (CLOSEOUT_EVENTS.has(canonical)) return "closeout";
  return null;
}

function isTruthyFlag(value) {
  return value === true || value === "true";
}

function isStopReentry(input, eventName) {
  if (!STOP_CONTINUATION_EVENTS.has(eventName)) return false;
  if (
    isTruthyFlag(input.stop_hook_active) ||
    isTruthyFlag(input.stopHookActive) ||
    isTruthyFlag(input.continuationActive) ||
    isTruthyFlag(input.continuation_active)
  ) {
    return true;
  }
  // Cursor signals a stop re-entry after a real follow-up with loop_count (#139).
  const loops = Number(input.loop_count ?? input.loopCount);
  return Number.isFinite(loops) && loops >= 1;
}

function quietSuccess() {
  return {};
}

function formatAdvice(verdict) {
  const lines = [
    "Bearing Lite " + verdict.hook_class + ": " + verdict.outcome,
    verdict.reason ? "reason: " + verdict.reason : "",
    verdict.recovery ? "recovery: " + verdict.recovery : "",
    verdict.write_lock ? "write_lock: " + verdict.write_lock : "",
    "Coverage: this host mapping is partial. activation and closeout are executable; bound assurance dispatch has its own pretool barrier; other transitions and protected_action remain procedural.",
  ].filter(Boolean);
  return lines.join("\n").slice(0, 4000);
}

/**
 * Translate a portable verdict into Claude Code / Codex JSON.
 * Exit status is never used for policy (RISK-12 / RISK-20).
 */
function toHostResponse(eventName, verdict) {
  const event = eventName || "SessionStart";
  const text = formatAdvice(verdict);
  const body = {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: text,
    },
  };
  // This mapping never requests protected_completion, so BLOCK should not
  // appear. If a future caller passes a BLOCK verdict, use JSON only.
  if (verdict.outcome === "BLOCK") {
    body.decision = "block";
    body.reason = text;
  }
  return body;
}

function detectWriteLock(host) {
  const isAgy = host === "agy" || process.argv.includes("--host=agy");
  try {
    if (isAgy) {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "hooks.json"), "utf8"));
      const wired = Object.values(manifest || {}).some((spec) =>
        isPlainObject(spec) &&
        spec.enabled !== false &&
        Array.isArray(spec.PreToolUse) &&
        spec.PreToolUse.some((entry) =>
          (entry.hooks || []).some((hook) =>
            String(hook.command || "").includes("orchestrator-write-lock")
          )
        )
      );
      return wired ? "present" : "absent";
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hooks.json"), "utf8"));
    const pre = manifest.hooks && manifest.hooks.PreToolUse;
    if (!Array.isArray(pre)) return "absent";
    const wired = pre.some((entry) =>
      (entry.hooks || []).some((hook) =>
        [hook.command, ...(hook.args || [])].some((arg) => String(arg).includes("orchestrator-write-lock.cjs"))
      )
    );
    return wired ? "present" : "absent";
  } catch {
    return "absent";
  }
}

function evaluateForHost(eventName, derived, input = {}, options = {}) {
  if (classForEvent(eventName) === "closeout") {
    const task = derived.active_task || {};
    return closeout.evaluate({
      verdict: presentString(task.verdict),
      candidate_ref: presentString(task.candidate_ref),
      changed_paths: presentString(task.changed_paths),
      tests: presentString(task.tests),
      findings: presentString(task.findings),
      blocker: presentString(task.blocker) || "none",
      required_assurance: task.required_assurance,
    });
  }
  return activation.evaluate({
    ...input,
    plan_present: derived.plan_present === true,
    next_action_known: derived.next_action_known === true,
    next_action: derived.next_action,
    assigned_role: derived.assigned_role,
    router_invoked: derived.router_invoked === true,
    write_lock: detectWriteLock(options.host),
  });
}

/**
 * @param {unknown} input
 * @param {{ host?: string }} [options]
 */
function handle(input, options = {}) {
  let parsed = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return quietSuccess();
    }
  }
  if (parsed === undefined || parsed === null) {
    return quietSuccess();
  }
  if (!isPlainObject(parsed)) {
    return quietSuccess();
  }

  const eventName = canonicalizeEvent(
    parsed.hook_event_name || parsed.hookEventName
  );
  if (!classForEvent(eventName)) return quietSuccess();

  if (isStopReentry(parsed, eventName)) {
    return quietSuccess();
  }

  const cwd =
    presentString(parsed.cwd) ||
    presentString(parsed.workspaceRoot) ||
    (Array.isArray(parsed.workspacePaths) && presentString(parsed.workspacePaths[0])) ||
    process.cwd();

  const bound = binding(parsed);
  if (!bound) return quietSuccess();
  let derived;
  try {
    derived = deriveContext(cwd, bound);
  } catch {
    return toHostResponse(
      eventName,
      activation.evaluate({ ...parsed, infrastructure_failure: "permission_error" })
    );
  }

  return toHostResponse(eventName, evaluateForHost(eventName, derived, parsed, options));
}

// Hosted replies measured under 450 ms. Leave that reserve so cleanup finishes inside the registration timeout.
const RESPONSE_RESERVE_MS = 450;
const ADAPTER_EVENTS = new Set(["SessionStart", "Stop"]);

function hostTimeoutSeconds(eventName, host) {
  if (host === "agy" || process.argv.includes("--host=agy")) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "hooks.json"), "utf8"));
      const target = eventName === "SessionStart" ? "activation" : "closeout";
      for (const spec of Object.values(manifest || {})) {
        if (!isPlainObject(spec) || spec.enabled === false || !Array.isArray(spec[eventName])) continue;
        for (const hook of spec[eventName]) {
          const cmd = String(hook.command || "");
          if (cmd.includes("com.google.antigravity/host.cjs") && cmd.includes(target)) {
            return hook.timeout;
          }
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  const cursor = host === "cursor" || process.argv.includes("--host=cursor");
  let manifest;
  try {
    const file = path.join(__dirname, "..", cursor ? "com.cursor/hooks.json" : "hooks.json");
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  const key = cursor ? { SessionStart: "sessionStart", Stop: "stop" }[eventName] : eventName;
  const entries = manifest.hooks && manifest.hooks[key];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    const hooks = Array.isArray(entry.hooks) ? entry.hooks : [entry];
    for (const hook of hooks) {
      if (!String(hook.command || "").includes("com.anthropic.claude-code/host.cjs")) continue;
      return hook.timeout;
    }
  }
  return undefined;
}

function decisionChoice(task) {
  const raw = task && task.decision_choice;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decisionRecordFile() {
  const root = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const dir = path.join(root, "bearing-lite");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "advisory-decisions.json");
}

async function applyAdapter(rawInput, response, enteredAt, options = {}) {
  let parsed = rawInput;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return response;
    }
  }
  if (!isPlainObject(parsed)) return response;
  const eventName = canonicalizeEvent(parsed.hook_event_name || parsed.hookEventName);
  if (!ADAPTER_EVENTS.has(eventName) || isStopReentry(parsed, eventName)) return response;
  const bound = binding(parsed);
  if (!bound) return response;
  const input = decisionChoice(bound.task);
  if (!input) return response;
  const timeout = hostTimeoutSeconds(eventName, options.host);
  if (typeof timeout !== "number" || !(timeout > 0)) return response;
  const result = await decisionAdapter.decide(input, {
    config_file: path.join(__dirname, "..", "decision-backend.json"),
    record_file: decisionRecordFile(),
    budget: {
      total_ms: timeout * 1000,
      elapsed_ms: performance.now() - enteredAt,
      reserve_ms: RESPONSE_RESERVE_MS,
    },
  });
  // Claude/Codex Stop has no advice field that does not continue the turn.
  if (eventName !== "SessionStart" || !result || typeof result.meaning !== "string" || !result.meaning) {
    return response;
  }
  const inner = isPlainObject(response.hookSpecificOutput) ? response.hookSpecificOutput : {};
  const prior = typeof inner.additionalContext === "string" ? inner.additionalContext : "";
  return {
    ...response,
    hookSpecificOutput: {
      ...inner,
      hookEventName: inner.hookEventName || "SessionStart",
      additionalContext: prior ? prior + "\n" + result.meaning : result.meaning,
    },
  };
}

async function main() {
  const enteredAt = performance.now();
  let raw = "";
  try {
    raw = readStdinSync();
  } catch {
    process.stdout.write(JSON.stringify(quietSuccess()) + "\n");
    process.exit(0);
    return;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    process.stdout.write(JSON.stringify(quietSuccess()) + "\n");
    process.exit(0);
    return;
  }

  let response = handle(trimmed);
  try {
    response = await applyAdapter(trimmed, response, enteredAt);
  } catch {
    // A failed advisory call leaves the existing host response unchanged.
  }
  response = cursorStop.projectStop(response);
  process.stdout.write(JSON.stringify(response) + "\n");
  process.exit(0);
}

module.exports = {
  HOST,
  COVERAGE,
  ASSURANCE_DISPATCH_COVERAGE,
  canonicalizeEvent,
  classForEvent,
  deriveContext,
  evaluateForHost,
  handle,
  applyAdapter,
  toHostResponse,
};

if (require.main === module) {
  main();
}

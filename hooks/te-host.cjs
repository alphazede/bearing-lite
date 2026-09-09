#!/usr/bin/env node
"use strict";

/**
 * Test Engineering host adapter (SEIT-EMV-017, SEIT-EMV-036).
 *
 * Two additional hook classes, `te_test_write` and `te_completion`. They do
 * not replace, rename, or extend the original four classes, and they do not
 * reuse the original four outcome tokens.
 *
 * Lite owns the adapter, never the policy. This module maps the host event to
 * a class, builds the request from real state — the installed Git checkout and
 * the coordinator-authored plan, never the writer's own tool payload — and
 * hands the request to the evaluator loaded by capability. The verdict comes
 * back verbatim. When the capability is inactive the class fails open; when it
 * is activated but unavailable the result is a typed gap, never silent
 * success.
 *
 * Always exit 0 (RISK-12 / RISK-20). Host blocking, where a host supports it
 * natively, is JSON-only — never process status. A valid completion verdict is
 * not user acceptance and grants no planning or publication authority.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const capability = require("./te-capability.cjs");

const TE_TEST_WRITE = "te_test_write";
const TE_COMPLETION = "te_completion";
const TE_CLASSES = Object.freeze([TE_TEST_WRITE, TE_COMPLETION]);

const ALLOW = "ALLOW";
const UNAVAILABLE = "UNAVAILABLE";
const DENY_ROUTE_TO_TE = "DENY_ROUTE_TO_TE";
const DENY_RECEIPT_REQUIRED = "DENY_RECEIPT_REQUIRED";
const VERDICTS = Object.freeze([
  ALLOW,
  DENY_ROUTE_TO_TE,
  DENY_RECEIPT_REQUIRED,
  UNAVAILABLE,
]);
const DENY_VERDICTS = new Set([DENY_ROUTE_TO_TE, DENY_RECEIPT_REQUIRED]);

const NATIVE = "native";

/**
 * Frozen host honesty table. `native` means the host exposes a real, verified
 * hard deny for that channel. Everything else is `UNAVAILABLE`: the class is
 * procedural there and this adapter must not advertise enforcement it cannot
 * perform.
 *
 * Cursor has a write-time deny. A Cursor `stop` `followup_message` is guidance,
 * not a hard completion block, and Cursor exposes no distinct hard child-stop
 * deny, so both completion channels stay `UNAVAILABLE`.
 */
const FULL_NATIVE = Object.freeze({
  write_time_deny: NATIVE,
  completion_deny: NATIVE,
  child_stop_deny: NATIVE,
});
const NO_NATIVE = Object.freeze({
  write_time_deny: UNAVAILABLE,
  completion_deny: UNAVAILABLE,
  child_stop_deny: UNAVAILABLE,
});
const HOST_SUPPORT = Object.freeze({
  grok: FULL_NATIVE,
  codex: FULL_NATIVE,
  "claude-code": FULL_NATIVE,
  cursor: Object.freeze({
    write_time_deny: NATIVE,
    completion_deny: UNAVAILABLE,
    child_stop_deny: UNAVAILABLE,
  }),
  kimi: NO_NATIVE,
  pi: NO_NATIVE,
  agy: NO_NATIVE,
  deepcode: NO_NATIVE,
});
const DEFAULT_HOST = "claude-code";

/** Derived runtime state. Never tracked, never a candidate change. */
const RUNTIME_DIR = ".bearing";
const STORE_SEGMENTS = Object.freeze([RUNTIME_DIR, "test-engineering"]);
const HANDOFF_FILE = "handoff.json";
const RECEIPT_FILE = "receipt.json";

const MAX_PLAN_FILES = 20;
const MAX_PLAN_BYTES = 256 * 1024;

const WRITE_EVENTS = new Set([
  "pretooluse",
  "beforeshellexecution",
  "applypatch",
]);
const COMPLETION_EVENTS = new Set(["stop", "subagentstop"]);
const CHILD_STOP_EVENTS = new Set(["subagentstop"]);

const TASK_LINE = /^###\s*task_id:\s*(\S+)\s*$/;
const FIELD_LINE =
  /^-\s*(assigned_role|role_instance|status|scope|authority|type):\s*(.*)$/;
const LEASE_REVISION = /^\s*-\s*candidate_revision:\s*(\S+)\s*$/m;
const TASK_MARK = /(?:^|\n)###\s*task_id:\s*\S+/;
const LEASE_MARK = /^\s*-\s*checkout_lease:/m;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function presentString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "unassigned" || /^<[^>]+>$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Normalize Claude, Codex, Grok, Cursor, and Kimi event spellings. */
function normalizeEvent(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/[_\-\s]/g, "").toLowerCase();
}

/**
 * @param {unknown} event
 * @returns {"te_test_write"|"te_completion"|null}
 */
function classForEvent(event) {
  const key = normalizeEvent(event);
  if (!key) return null;
  if (WRITE_EVENTS.has(key)) return TE_TEST_WRITE;
  if (COMPLETION_EVENTS.has(key)) return TE_COMPLETION;
  return null;
}

/** Which host honesty channel this event needs. */
function supportChannel(hookClass, event) {
  if (hookClass === TE_TEST_WRITE) return "write_time_deny";
  return CHILD_STOP_EVENTS.has(normalizeEvent(event))
    ? "child_stop_deny"
    : "completion_deny";
}

/**
 * Run the installed native Git executable with argv and shell=false.
 * @returns {string|null} trimmed stdout, or null when Git could not answer
 */
function git(root, ...args) {
  let result;
  try {
    result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  } catch {
    return null;
  }
  if (!result || result.status !== 0 || typeof result.stdout !== "string") {
    return null;
  }
  return result.stdout.trim();
}

function rankPlan(name) {
  const n = name.toLowerCase();
  if (n === "plan.md" || n === "progress.md") return 0;
  if (n.includes("plan")) return 1;
  return 5;
}

/** Bounded, top-level Markdown scan of the workspace root. */
function planFiles(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => rankPlan(a) - rankPlan(b) || a.localeCompare(b))
    .slice(0, MAX_PLAN_FILES)
    .map((name) => path.join(root, name));
}

function parseTasks(text) {
  const tasks = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
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
  return tasks;
}

function splitScope(value) {
  return String(value === undefined ? "" : value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const EMPTY_ASSIGNMENT = Object.freeze({
  task_id: null,
  assigned_role: null,
  role_instance: null,
  write_set: Object.freeze([]),
  authority: null,
  authority_id: null,
  candidate_revision: null,
  type: null,
});

/**
 * Trusted assignment and diff base, taken only from the coordinator-authored
 * plan in the workspace. The writer's own tool payload and transcript are
 * never a source here.
 *
 * `authority_id` and `candidate_revision` are the evaluator's spellings for
 * the plan's own `authority` and checkout-lease revision. They are the same
 * trusted values under the names the consumer reads; the writer's payload
 * still never reaches them.
 */
function readTrustedPlan(root) {
  for (const file of planFiles(root)) {
    let text;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_PLAN_BYTES) continue;
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const hasLease = LEASE_MARK.test(text);
    if (!TASK_MARK.test(text) && !hasLease) continue;

    const tasks = parseTasks(text);
    const active =
      tasks.find((task) => {
        const status = presentString(task.status);
        return status && status !== "COMPLETE" && status !== "CANCELLED";
      }) ||
      tasks[0] ||
      null;
    const revision = text.match(LEASE_REVISION);
    const diffBase = revision ? revision[1] : null;
    const authority = active ? presentString(active.authority) ?? null : null;

    return {
      diff_base: diffBase,
      assignment: {
        task_id: active ? presentString(active.task_id) ?? null : null,
        assigned_role: active ? presentString(active.assigned_role) ?? null : null,
        role_instance: active ? presentString(active.role_instance) ?? null : null,
        write_set: splitScope(active ? active.scope : ""),
        authority,
        authority_id: authority,
        candidate_revision: diffBase,
        type: active ? presentString(active.type) ?? null : null,
      },
    };
  }
  return { diff_base: null, assignment: { ...EMPTY_ASSIGNMENT, write_set: [] } };
}

/**
 * A path is in the candidate only when the trusted write set covers it. An
 * empty trusted scope covers nothing, so unrelated shared dirt stays out.
 */
function inScope(relPath, scopePaths) {
  return scopePaths.some((entry) => {
    const scope = entry.replace(/\/+$/, "");
    if (!scope) return false;
    return relPath === scope || relPath.startsWith(scope + "/");
  });
}

function porcelainPath(line) {
  const raw = line.slice(3).trim();
  if (!raw) return "";
  const rename = raw.indexOf(" -> ");
  const target = rename >= 0 ? raw.slice(rename + 4) : raw;
  return target.replace(/^"|"$/g, "");
}

/**
 * Real candidate state from the installed Git checkout: the committed
 * `diff_base..HEAD` change plus the working tree, scoped to the trusted write
 * set. Derived runtime state is never a candidate change.
 */
function readCandidate(root, diffBase, scopePaths) {
  const revision = git(root, "rev-parse", "HEAD");
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const changed = new Set();

  if (diffBase && revision) {
    const committed = git(root, "diff", "--name-only", diffBase, "HEAD");
    if (committed) {
      for (const line of committed.split("\n")) {
        const value = line.trim();
        if (value) changed.add(value);
      }
    }
  }

  const status = git(root, "status", "--porcelain", "--untracked-files=all");
  if (status) {
    for (const line of status.split("\n")) {
      const value = porcelainPath(line);
      if (value) changed.add(value);
    }
  }

  const changedPaths = [...changed]
    .filter((entry) => entry.split("/")[0] !== RUNTIME_DIR)
    .filter((entry) => inScope(entry, scopePaths))
    .sort();

  return {
    checkout: root,
    branch: branch || null,
    revision: revision || null,
    diff_base: diffBase || null,
    scope_paths: scopePaths,
    changed_paths: changedPaths,
  };
}

function relativeTarget(root, value) {
  const target = presentString(value);
  if (!target) return null;
  return path.isAbsolute(target) ? path.relative(root, target) : target;
}

/** Paths the host event names. Advisory only: never a source of authority. */
function readTargetPaths(input, root, resolvedToolInput) {
  const toolInput = resolvedToolInput || {};
  const out = new Set();
  for (const value of [
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.notebook_path,
    input.file_path,
    input.filePath,
  ]) {
    const target = relativeTarget(root, value);
    if (target) out.add(target);
  }
  for (const list of [toolInput.file_paths, toolInput.paths]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const target = relativeTarget(root, value);
      if (target) out.add(target);
    }
  }
  return [...out].sort();
}

/**
 * Read a Test Engineering artifact from the derived runtime store. Presence is
 * reported, never interpreted: only the evaluator decides what a handoff or a
 * receipt means.
 */
function readArtifact(root, file) {
  const relative = path.join(...STORE_SEGMENTS, file);
  const target = path.join(root, relative);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return { path: relative, exists: false, raw: null };
  }
  if (!stat.isFile()) return { path: relative, exists: false, raw: null };
  let raw = null;
  try {
    raw = fs.readFileSync(target, "utf8");
  } catch {
    raw = null;
  }
  return { path: relative, exists: true, raw };
}

/**
 * One request, spelled the way the evaluator reads it. `workspaceRoot`,
 * `tool_name`, `tool_input`, `revision` and `diff_base` are the supported
 * consumer fields (S25-INT-001); each carries a value Lite already computed
 * from the envelope, the trusted plan, or the real checkout, so nothing here
 * is a second source of truth. The existing `workspace_root` field and the
 * nested `candidate`, `assignment`, `target_paths`, `handoff` and `receipt`
 * records stay for Lite's own consumers; `workspace_root` and `workspaceRoot`
 * are the one resolved envelope root under both spellings.
 */
function buildRequest(hookClass, event, input, root, host) {
  const plan = readTrustedPlan(root);
  const candidate = readCandidate(root, plan.diff_base, plan.assignment.write_set);
  const toolInput = isPlainObject(input.tool_input)
    ? input.tool_input
    : isPlainObject(input.toolInput)
      ? input.toolInput
      : null;
  return {
    hook_class: hookClass,
    event: typeof event === "string" ? event.trim() : "",
    workspace_root: root,
    workspaceRoot: root,
    candidate,
    assignment: plan.assignment,
    revision: candidate.revision,
    diff_base: candidate.diff_base,
    tool_name: presentString(input.tool_name) ?? presentString(input.toolName) ?? null,
    tool_input: toolInput,
    target_paths: readTargetPaths(input, root, toolInput),
    handoff: readArtifact(root, HANDOFF_FILE),
    receipt: readArtifact(root, RECEIPT_FILE),
    host,
  };
}

function hostOutput(hookClass, verdict, reason, extra) {
  const body = {
    hookSpecificOutput: {
      capability: capability.CAPABILITY,
      hookClass: hookClass || null,
      verdict,
      reason,
      invented: false,
    },
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined && value !== null) body.hookSpecificOutput[key] = value;
  }
  return body;
}

function unavailable(hookClass, reason, extra) {
  return hostOutput(hookClass, UNAVAILABLE, reason, extra);
}

/**
 * Translate the evaluator verdict into host JSON. A deny uses the host's own
 * native mechanism and nothing else; the process exit stays 0.
 */
function toHostResponse(hookClass, verdict, reason, extra) {
  const body = hostOutput(hookClass, verdict, reason, extra);
  if (!DENY_VERDICTS.has(verdict)) return body;
  const text = `Bearing Lite ${hookClass}: ${verdict} — ${reason}`;
  if (hookClass === TE_TEST_WRITE) {
    body.hookSpecificOutput.permissionDecision = "deny";
    body.hookSpecificOutput.permissionDecisionReason = text;
  } else {
    body.decision = "block";
    body.reason = text;
  }
  return body;
}

/**
 * @param {unknown} envelope host stdin payload
 * @param {{ selected?: boolean, required?: boolean, host?: string }} [options]
 */
function handle(envelope, options) {
  const opts = isPlainObject(options) ? options : {};
  let input = envelope;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return unavailable(null, "malformed_input: host envelope is not JSON");
    }
  }
  if (!isPlainObject(input)) {
    return unavailable(null, "malformed_input: host envelope is not an object");
  }

  const event = input.hook_event_name || input.hookEventName || input.event || "";
  const eventName = typeof event === "string" ? event.trim() : "";
  const hookClass = classForEvent(event);
  if (!hookClass) {
    return unavailable(
      null,
      "unmapped_host_event: no test-engineering class maps this event; fail open",
      { hookEventName: eventName || undefined }
    );
  }

  const host = presentString(opts.host) || DEFAULT_HOST;
  const channel = supportChannel(hookClass, event);
  const support = HOST_SUPPORT[host];
  if (!support || support[channel] !== NATIVE) {
    return unavailable(
      hookClass,
      `host_enforcement_unavailable: host "${host}" has no native ${channel}; ` +
        `${hookClass} is unsupported here and stays procedural`,
      { hookEventName: eventName, host, code: "host_enforcement_unavailable" }
    );
  }

  const root = path.resolve(
    presentString(input.cwd) || presentString(input.workspaceRoot) || process.cwd()
  );

  const resolved = capability.resolve({
    workspaceRoot: root,
    selected: opts.selected === true,
    required: opts.required === true,
  });
  if (resolved.status === "INACTIVE") {
    return unavailable(
      hookClass,
      "capability_inactive: test-engineering is unselected and not required; " +
        "the class fails open and this is not a failure",
      { hookEventName: eventName, code: resolved.code }
    );
  }
  if (resolved.status !== "ACTIVE" || !resolved.evaluator) {
    return unavailable(hookClass, resolved.message || "typed_capability_gap", {
      hookEventName: eventName,
      code: resolved.code || "typed_capability_gap",
      recovery: resolved.recovery,
    });
  }

  let result;
  try {
    const request = buildRequest(hookClass, eventName, input, root, host);
    result =
      hookClass === TE_TEST_WRITE
        ? resolved.evaluator.evaluateTestWrite(request)
        : resolved.evaluator.evaluateCompletion(request);
  } catch {
    return unavailable(
      hookClass,
      "evaluator_failure: the test-engineering evaluator did not return a " +
        "verdict; enforcement is unavailable for this event",
      { hookEventName: eventName, code: "evaluator_failure" }
    );
  }

  const verdict = isPlainObject(result) ? result.verdict : null;
  if (!VERDICTS.includes(verdict)) {
    return unavailable(
      hookClass,
      "evaluator_verdict_unrecognized: enforcement is unavailable for this event",
      { hookEventName: eventName, code: "evaluator_verdict_unrecognized" }
    );
  }

  const reason =
    (isPlainObject(result) ? presentString(result.reason) : undefined) ||
    "test_engineering_verdict";
  return toHostResponse(hookClass, verdict, reason, { hookEventName: eventName });
}

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
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

function main() {
  let raw = "";
  let response;
  try {
    raw = readStdinSync();
    response = handle(raw, {
      selected: flag(process.env.BEARING_TEST_ENGINEERING_SELECTED),
      required: flag(process.env.BEARING_TEST_ENGINEERING_REQUIRED),
      host: argValue("host") || process.env.BEARING_HOST,
    });
  } catch {
    response = unavailable(
      null,
      "adapter_failure: the test-engineering adapter could not run; unavailable"
    );
  }
  process.stdout.write(JSON.stringify(response) + "\n");
  process.exit(0);
}

module.exports = {
  TE_CLASSES,
  VERDICTS,
  HOST_SUPPORT,
  DEFAULT_HOST,
  classForEvent,
  supportChannel,
  handle,
  toHostResponse,
};

if (require.main === module) {
  main();
}

#!/usr/bin/env node
"use strict";

/**
 * Orchestrator write-set lock (#112). Pure evaluator plus PreToolUse adapter.
 * Denies Orchestrator (no / empty / orchestrator BEARING_ROLE) writes to
 * planning and requirement-library artifacts. Native write-time deny only;
 * other hosts fail open as UNAVAILABLE. Always exit 0.
 */

const fs = require("node:fs");
const path = require("node:path");

const ALLOW = "ALLOW";
const DENY_DISPATCH = "DENY_DISPATCH";
const UNAVAILABLE = "UNAVAILABLE";
const VERDICTS = Object.freeze([ALLOW, DENY_DISPATCH, UNAVAILABLE]);

const NATIVE = "native";
const HOST_SUPPORT = Object.freeze({
  grok: NATIVE,
  codex: NATIVE,
  "claude-code": NATIVE,
  copilot: NATIVE,
  cursor: NATIVE,
});
const DEFAULT_HOST = "claude-code";

const WRITE_EVENTS = new Set([
  "pretooluse",
  "beforeshellexecution",
  "applypatch",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function presentString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function posix(value) {
  return String(value).replace(/\\/g, "/");
}

function basename(rel) {
  const n = posix(rel).replace(/\/+$/, "");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

function normalizeEvent(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/[_\-\s]/g, "").toLowerCase();
}

function normalizeRole(value) {
  const role = presentString(value);
  if (!role) return "";
  return role.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isOrchestrator(role) {
  return !role || role === "orchestrator";
}

function ownerFor(rel) {
  const n = posix(rel);
  const b = basename(n);
  if (b === "workspace.md" || b === "repository-map.md") {
    return "architectural_alignment";
  }
  if (
    n === "docs/coe" ||
    n.startsWith("docs/coe/") ||
    n.includes("/docs/coe/") ||
    /(?:^|\/)docs\/coe(?:\/|$)/.test(n)
  ) {
    return "requirements_engineer";
  }
  if (
    b === "design.md" ||
    b === "seit.json" ||
    b === "implementation.json" ||
    b.endsWith("-technical-plan.md") ||
    b.endsWith("-dod-manifest.html")
  ) {
    return "planning_and_design";
  }
  return null;
}

function dispatchFor(owner) {
  return `Dispatch skills/${owner.replace(/_/g, "-")} with BEARING_ROLE=${owner}`;
}

const LOCKED_TOKEN_RE =
  /(?:^|[^\w./-])((?:[\w./-]*\/)?(?:design\.md|workspace\.md|seit\.json|implementation\.json|repository-map\.md|[\w.-]*-technical-plan\.md|[\w.-]*-dod-manifest\.html|docs\/coe(?:\/[\w./-]*)?))(?:[^\w./-]|$)/g;

function fieldText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  return undefined;
}

function scanLockedTokens(text, out) {
  if (typeof text !== "string" || !text) return;
  const hits = text.match(LOCKED_TOKEN_RE);
  if (!hits) return;
  for (const hit of hits) {
    const token = hit.replace(/^[^\w./-]+|[^\w./-]+$/g, "");
    if (token) out.add(posix(token));
  }
}

function collectPaths(input) {
  const out = new Set();
  const toolInput = isPlainObject(input.tool_input)
    ? input.tool_input
    : isPlainObject(input.toolInput)
      ? input.toolInput
      : {};
  for (const value of [
    ...(Array.isArray(input.paths) ? input.paths : []),
    toolInput.file_path,
    toolInput.filePath,
    toolInput.path,
    toolInput.file,
    toolInput.filename,
    toolInput.notebook_path,
    input.file_path,
    input.filePath,
    input.file,
    input.filename,
  ]) {
    const target = presentString(value);
    if (target) out.add(posix(target));
  }
  for (const list of [toolInput.file_paths, toolInput.paths]) {
    if (!Array.isArray(list)) continue;
    for (const value of list) {
      const target = presentString(value);
      if (target) out.add(posix(target));
    }
  }
  scanLockedTokens(presentString(toolInput.command) || presentString(input.command), out);
  for (const key of ["patch", "diff", "content", "text", "edits"]) {
    scanLockedTokens(fieldText(toolInput[key]) || fieldText(input[key]), out);
  }
  return [...out];
}

/**
 * @param {unknown} input
 * @returns {{ verdict: string, reason: string, owner?: string, dispatch?: string }}
 */
function evaluate(input) {
  const body = isPlainObject(input) ? input : {};
  const role = normalizeRole(body.role || body.BEARING_ROLE);
  const paths = collectPaths(body);
  if (!isOrchestrator(role)) {
    return { verdict: ALLOW, reason: "role_write_allowed" };
  }
  for (const rel of paths) {
    const owner = ownerFor(rel);
    if (!owner) continue;
    const dispatch = dispatchFor(owner);
    const delta =
      body.finding === true || owner === "planning_and_design"
        ? " Dispatch a planning delta; do not edit the artifact."
        : "";
    return {
      verdict: DENY_DISPATCH,
      reason: `Orchestrator cannot write ${basename(rel)}; owning role is ${owner}.${delta} ${dispatch}`,
      owner,
      dispatch,
    };
  }
  return { verdict: ALLOW, reason: "path_not_locked" };
}

function relativeTarget(root, value) {
  const target = presentString(value);
  if (!target) return null;
  return path.isAbsolute(target) ? path.relative(root, target) : target;
}

function envelopePaths(input, root) {
  const toolInput = isPlainObject(input.tool_input)
    ? input.tool_input
    : isPlainObject(input.toolInput)
      ? input.toolInput
      : {};
  const seeded = { ...input, tool_input: toolInput, paths: [] };
  const collected = collectPaths(seeded);
  return collected.map((value) => relativeTarget(root, value) || value);
}

function hostOutput(verdict, reason, extra) {
  const body = {
    hookSpecificOutput: {
      hookClass: "orchestrator_write_lock",
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

function toHostResponse(verdict, reason, extra) {
  const body = hostOutput(verdict, reason, extra);
  if (verdict !== DENY_DISPATCH) return body;
  const text = `Bearing Lite orchestrator_write_lock: ${verdict} — ${reason}`;
  body.hookSpecificOutput.permissionDecision = "deny";
  body.hookSpecificOutput.permissionDecisionReason = text;
  return body;
}

function toWire(response) {
  const inner = isPlainObject(response.hookSpecificOutput) ? response.hookSpecificOutput : {};
  if (inner.permissionDecision === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: inner.permissionDecisionReason,
      },
    };
  }
  return {};
}

function handle(envelope, options) {
  const opts = isPlainObject(options) ? options : {};
  let input = envelope;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return hostOutput(UNAVAILABLE, "malformed_input: host envelope is not JSON");
    }
  }
  if (!isPlainObject(input)) {
    return hostOutput(UNAVAILABLE, "malformed_input: host envelope is not an object");
  }

  const event = input.hook_event_name || input.hookEventName || input.event || "";
  const eventName = typeof event === "string" ? event.trim() : "";
  if (eventName && !WRITE_EVENTS.has(normalizeEvent(eventName))) {
    return hostOutput(UNAVAILABLE, "unmapped_host_event: write lock ignores this event", {
      hookEventName: eventName || undefined,
    });
  }

  const host = presentString(opts.host) || DEFAULT_HOST;
  if (HOST_SUPPORT[host] !== NATIVE) {
    return hostOutput(
      UNAVAILABLE,
      `host_enforcement_unavailable: host "${host}" has no native write-time deny; fallback is procedural`,
      { hookEventName: eventName, host, code: "host_enforcement_unavailable" }
    );
  }

  const root = path.resolve(
    presentString(input.cwd) || presentString(input.workspaceRoot) || process.cwd()
  );
  const role =
    presentString(opts.role) ||
    presentString(process.env.BEARING_ROLE) ||
    presentString(input.role) ||
    presentString(input.BEARING_ROLE) ||
    presentString(input.assigned_role);
  const result = evaluate({
    role,
    paths: envelopePaths(input, root),
    tool_input: isPlainObject(input.tool_input)
      ? input.tool_input
      : isPlainObject(input.toolInput)
        ? input.toolInput
        : {},
    finding: input.finding === true,
  });
  return toHostResponse(result.verdict, result.reason, {
    hookEventName: eventName,
    host,
    owner: result.owner,
    dispatch: result.dispatch,
  });
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
  let response;
  try {
    const raw = readStdinSync();
    response = handle(raw, {
      host: argValue("host") || process.env.BEARING_HOST,
      role: process.env.BEARING_ROLE,
    });
  } catch {
    response = hostOutput(UNAVAILABLE, "adapter_failure: orchestrator write lock could not run");
  }
  process.stderr.write(JSON.stringify(response) + "\n");
  process.stdout.write(JSON.stringify(toWire(response)) + "\n");
  process.exit(0);
}

module.exports = {
  VERDICTS,
  HOST_SUPPORT,
  DEFAULT_HOST,
  evaluate,
  handle,
  toWire,
  ownerFor,
};

if (require.main === module) {
  main();
}

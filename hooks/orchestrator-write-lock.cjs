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

// Build identity (#129): a refusal must name the build that produced it.
// package.json is the canonical source: it ships at the plugin root (one
// level above hooks/) in both a repo checkout and an installed plugin cache
// directory, so resolving relative to __dirname (not cwd) works in both.
// plugin.json mirrors the version and is the fallback; "unknown" is the
// last resort so the hook never throws when manifests are absent.
function readManifestVersion(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const version = data && typeof data.version === "string" ? data.version.trim() : "";
    return version || undefined;
  } catch {
    return undefined;
  }
}

let cachedVersion;
function hookVersion() {
  if (cachedVersion) return cachedVersion;
  const root = path.join(__dirname, "..");
  cachedVersion =
    readManifestVersion(path.join(root, "package.json")) ||
    readManifestVersion(path.join(root, "plugin.json")) ||
    "unknown";
  return cachedVersion;
}

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

function mentionsLockedToken(text) {
  if (typeof text !== "string" || !text) return false;
  LOCKED_TOKEN_RE.lastIndex = 0;
  return LOCKED_TOKEN_RE.test(text);
}

function stripQuotes(value) {
  const s = String(value);
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function isLockedPath(value) {
  const target = presentString(value);
  if (!target) return false;
  return ownerFor(posix(stripQuotes(target))) !== null;
}

function loadRoundLock(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, ".bearing-round.lock"), "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function isUnder(root, planDir, target) {
  const base = path.resolve(root, presentString(planDir) || ".");
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
  const rel = path.relative(base, abs);
  return rel === "" || (rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

// Verbs that mutate any locked path passed as an operand (rm, truncate, ...).
const WRITE_ANY_VERBS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "truncate",
  "touch",
  "tee",
  "chmod",
  "chown",
  "chattr",
  "patch",
  "ed",
  "ex",
  "vi",
  "vim",
  "nvim",
  "nano",
  "emacs",
  "micro",
  "rename",
]);

// Verbs that only threaten the protected path as the destination operand.
const WRITE_DEST_VERBS = new Set(["mv", "cp", "install", "ln"]);

const GIT_WRITE_SUBCOMMANDS = new Set([
  "apply",
  "checkout",
  "restore",
  "mv",
  "rm",
  "clean",
  "am",
  "update-index",
]);

const SHELL_VERBS = new Set(["sh", "bash", "dash", "ksh", "zsh"]);

// In-place edit drivers: only a write when the in-place flag is present.
const INPLACE_VERBS = new Set(["sed", "perl", "ruby", "awk", "gawk"]);

// Write() calls inside interpreter one-liners, e.g. open(f, "w").
const SCRIPT_WRITE_CALL_RE =
  /writeFile(Sync)?\s*\(|appendFile(Sync)?\s*\(|createWriteStream\s*\(|file_put_contents\s*\(|["'][wax][bt+]*\+?["']|["']\+?>{1,2}["']/;
const SCRIPT_VERBS = new Set([
  "python",
  "python3",
  "node",
  "deno",
  "bun",
  "ruby",
  "php",
  "perl",
]);

const WRAPPER_PREFIXES = new Set(["sudo", "doas", "command", "builtin", "env"]);

function splitTokens(segment) {
  return String(segment)
    .split(/\s+/)
    .filter(Boolean);
}

function verbOf(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const raw = stripQuotes(tokens[i]);
    if (WRAPPER_PREFIXES.has(basename(raw))) {
      i += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) {
      i += 1;
      continue;
    }
    return { verb: basename(raw), index: i };
  }
  return { verb: "", index: tokens.length };
}

function operandsOf(tokens, from) {
  const out = [];
  for (let i = from; i < tokens.length; i += 1) {
    const raw = stripQuotes(tokens[i]);
    if (!raw || raw === "-" || raw === "--") continue;
    if (raw.startsWith("-") && !/^-\d/.test(raw)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw) && !/^(of|if)=/i.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

function quotedRanges(text) {
  const ranges = [];
  let quote = null;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") {
        ranges.push([start, i]);
        quote = null;
      }
    } else if ((ch === '"' || ch === "'") && !/[A-Za-z0-9_]$/.test(text.slice(0, i))) {
      quote = ch;
      start = i;
    }
  }
  return ranges;
}

function inRanges(ranges, index) {
  return ranges.some(([from, to]) => index > from && index < to);
}

function cleanTarget(value) {
  return String(value || "").replace(/^["']+/, "");
}

function unwrapPayload(text) {
  const t = String(text).trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return t.slice(1, -1);
    }
  }
  return text;
}

function stripQuotedSpans(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      else out += " ";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

function segmentWritesLocked(segment, depth) {
  let text = String(segment);
  if (!mentionsLockedToken(text)) return false;
  if ((depth || 0) > 2) return true;

  // A `-c` payload runs as a nested command: assess it directly, since its
  // quotes are execution syntax, not printed text. Then assess the outer
  // remainder (e.g. `bash -c 'echo hi' > design.md`).
  const outerTokens = splitTokens(text);
  if (outerTokens.length) {
    const outer = verbOf(outerTokens);
    if (SHELL_VERBS.has(outer.verb)) {
      const args = outerTokens.slice(outer.index + 1);
      const flagAt = args.findIndex((token) => /^(--command$|-[A-Za-z]*c)/.test(stripQuotes(token)));
      if (flagAt >= 0) {
        const payload = unwrapPayload(args.slice(flagAt + 1).join(" "));
        if (segmentWritesLocked(payload, (depth || 0) + 1)) return true;
        text = stripQuotedSpans(text);
        if (!mentionsLockedToken(text)) return false;
      } else {
        return false;
      }
    }
  }

  // Redirection onto a locked path: `>`, `>>`, `>|`, `<>`, `2>`, `of=`.
  // A `>` inside quotes is printed text, not a redirect (`echo "a > b"`).
  const quotes = quotedRanges(text);
  for (const redirect of text.matchAll(/(?:\d+\s*)?(>>?\|?|<>)\s*(["']?)([^\s|&;]+)/g)) {
    const operatorIndex = (redirect.index || 0) + redirect[0].indexOf(redirect[1]);
    if (inRanges(quotes, operatorIndex)) continue;
    if (isLockedPath(cleanTarget(redirect[3]))) return true;
  }
  for (const dd of text.matchAll(/\bof\s*=\s*(["']?)([^\s|&;]+)/gi)) {
    if (inRanges(quotes, dd.index || 0)) continue;
    if (isLockedPath(cleanTarget((dd[1] || "") + dd[2]))) return true;
  }

  const tokens = splitTokens(text);
  if (!tokens.length) return false;
  const { verb, index } = verbOf(tokens);
  const rest = tokens.slice(index + 1).join(" ");

  if (WRITE_ANY_VERBS.has(verb)) {
    return operandsOf(tokens, index + 1).some(isLockedPath);
  }
  if (WRITE_DEST_VERBS.has(verb)) {
    const operands = operandsOf(tokens, index + 1);
    return operands.length > 0 && isLockedPath(operands[operands.length - 1]);
  }
  if (verb === "git") {
    const operands = operandsOf(tokens, index + 1);
    const sub = String(operands[0] || "").toLowerCase();
    if (GIT_WRITE_SUBCOMMANDS.has(sub)) return operands.some(isLockedPath);
    return false;
  }
  if (verb === "find") {
    if (/(^|\s)(-delete)(\s|$)/.test(` ${rest} `)) return true;
    const exec = rest.match(/-exec(dir)?\s+([^\s]+)/);
    if (exec && (WRITE_ANY_VERBS.has(basename(exec[2])) || WRITE_DEST_VERBS.has(basename(exec[2])))) {
      return true;
    }
    return false;
  }
  if (INPLACE_VERBS.has(verb)) {
    if (/(^|\s)--in-place(\s|=|$)|(^\s*|\s)-[A-Za-z]*i/i.test(` ${rest}`)) {
      return operandsOf(tokens, index + 1).some(isLockedPath);
    }
    return false;
  }
  if (verb === "dd") return false;
  if (verb === "apply_patch" || verb === "applypatch" || verb === "patch") {
    return true;
  }
  if (SCRIPT_VERBS.has(verb)) {
    return SCRIPT_WRITE_CALL_RE.test(text);
  }
  if (verb === "xargs") {
    const operands = operandsOf(tokens, index + 1);
    if (operands.some((token) => WRITE_ANY_VERBS.has(basename(String(token))))) return true;
    return false;
  }
  return false;
}

function scanCommandWriteTargets(command, out) {
  if (typeof command !== "string" || !command) return;
  if (!mentionsLockedToken(command)) return;
  // Split pipelines / lists so `cat locked | tee /tmp/out` stays a read of
  // the locked path: only the segment that writes it counts.
  const segments = String(command).split(/[|\n;]+/).flatMap((part) => part.split(/&&|\|\|/));
  for (const segment of segments) {
    if (!mentionsLockedToken(segment)) continue;
    if (!segmentWritesLocked(segment, 0)) continue;
    LOCKED_TOKEN_RE.lastIndex = 0;
    let hit;
    const guard = { count: 0 };
    while ((hit = LOCKED_TOKEN_RE.exec(segment)) !== null && guard.count < 25) {
      guard.count += 1;
      const token = String(hit[1] || "").replace(/^[^\w./-]+|[^\w./-]+$/g, "");
      if (token && ownerFor(posix(token)) !== null) out.add(posix(token));
    }
    LOCKED_TOKEN_RE.lastIndex = 0;
  }
}

// Patch/diff bodies describe write operations, so only their file-target
// lines (not prose inside added lines) name write targets.
function scanPatchTargets(text, out) {
  if (typeof text !== "string" || !text) return;
  for (const line of text.split("\n")) {
    const target =
      line.match(/^\s*\*\*\*\s*(?:Update|Add|Delete|Rename)\s+File:\s*(\S+)/) ||
      line.match(/^\s*(?:---|\+\+\+)\s+(?:[ab]\/)?(\S+)/) ||
      line.match(/^\s*(?:File|Path):\s*(\S+)/i);
    if (!target) continue;
    const candidate = stripQuotes(target[1].replace(/[,:;]+$/, ""));
    if (isLockedPath(candidate)) out.add(posix(stripQuotes(candidate)));
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
  // A bare mention of a protected filename inside a shell command or file
  // body is not a write to that file (#158). Only command segments that
  // genuinely write the protected path, and patch/diff file-target lines,
  // count as write attempts.
  scanCommandWriteTargets(
    presentString(toolInput.command) || presentString(input.command),
    out
  );
  for (const key of ["patch", "diff"]) {
    scanPatchTargets(fieldText(toolInput[key]) || fieldText(input[key]), out);
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
  // An in-process subagent carries agent_id; a role-less subagent is never
  // the Orchestrator, while a role-less session without agent_id is.
  const agentId = presentString(body.agent_id);
  const paths = collectPaths(body);
  if (!isOrchestrator(role)) {
    return { verdict: ALLOW, reason: "role_write_allowed" };
  }
  for (const rel of paths) {
    const owner = ownerFor(rel);
    if (!owner) continue;
    // DES-146.01: workspace.md / repository-map.md are Orchestrator-owned.
    // Only the Orchestrator itself skips the deny: an explicit orchestrator
    // role, or a role-less session that is not an in-process subagent.
    if (owner === "architectural_alignment" && (role === "orchestrator" || !agentId)) continue;
    const dispatch = dispatchFor(owner);
    const delta =
      body.finding === true || owner === "planning_and_design"
        ? " Dispatch a planning delta; do not edit the artifact."
        : "";
    // A role-less session is never silently treated as the Orchestrator:
    // name the separate-process BEARING_ROLE fallback instead.
    const reason =
      role === "orchestrator"
        ? `Orchestrator cannot write ${basename(rel)}; owning role is ${owner}.${delta} ${dispatch} (bearing-lite v${hookVersion()})`
        : `Session without a role cannot write ${basename(rel)}; owning role is ${owner}. Run it as a separate process with BEARING_ROLE=${owner}.${delta} ${dispatch} (bearing-lite v${hookVersion()})`;
    return {
      verdict: DENY_DISPATCH,
      reason,
      owner,
      dispatch,
    };
  }
  const root = presentString(body.cwd) || process.cwd();
  const round = loadRoundLock(root);
  if (round && isOrchestrator(role)) {
    for (const rel of paths) {
      if (!isUnder(root, round.plan_dir, rel)) continue;
      return {
        verdict: DENY_DISPATCH,
        reason: `frozen_candidate: review is bound to ${presentString(round.candidate) || "the frozen candidate"}; Orchestrator plan-dir writes are deferred (bearing-lite v${hookVersion()})`,
        owner: "planning_and_design",
        dispatch: dispatchFor("planning_and_design"),
      };
    }
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
      version: hookVersion(),
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
  // AC-146.02: the envelope role of an in-process subagent wins over the
  // inherited parent BEARING_ROLE.
  const subagentRole = presentString(input.agent_id)
    ? presentString(input.assigned_role)
    : undefined;
  const role =
    subagentRole ||
    presentString(opts.role) ||
    presentString(process.env.BEARING_ROLE) ||
    presentString(input.role) ||
    presentString(input.BEARING_ROLE) ||
    presentString(input.assigned_role);
  const result = evaluate({
    role,
    agent_id: presentString(input.agent_id),
    cwd: root,
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
  hookVersion,
};

if (require.main === module) {
  main();
}

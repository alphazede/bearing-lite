#!/usr/bin/env node
"use strict";

/**
 * Antigravity (AGY) host adapter.
 * Translates AGY camelCase hook envelopes (`conversationId`, `workspacePaths`,
 * `toolCall`, `continuationActive`) and emits AGY protojson responses
 * (`injectSteps`, `decision: "allow"|"deny"`, `decision: "continue"`, or `{}`).
 * Always exits 0 and always writes one valid JSON object to stdout.
 */

const fs = require("node:fs");

const claudeHost = require("../com.anthropic.claude-code/host.cjs");
const cursorStop = require("../cursor-stop.cjs");
const teHost = require("../te-host.cjs");
const writeLock = require("../orchestrator-write-lock.cjs");
const assuranceDispatch = require("../assurance-dispatch.cjs");
const gitSync = require("../git-sync.cjs");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function presentString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
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

function fileTargets(args, nativeKey) {
  const paths = [...new Set([args[nativeKey], args.Path, args.TargetFile, args.path]
    .filter((value) => typeof value === "string" && value.trim()))];
  const [file_path = ""] = paths;
  return paths.length > 1 ? { file_path, file_paths: paths } : { file_path };
}

function replacementFields(value, nativeEdit) {
  const args = isPlainObject(value) ? value : {};
  return {
    old_string: nativeEdit ? args.Target : args.TargetContent ?? args.Target,
    new_string: nativeEdit ? args.Replacement : args.ReplacementContent ?? args.Replacement,
    replace_all: args.AllowMultiple ?? false,
  };
}

/** Map AGY `toolCall` names/args to the canonical names expected by write/TE hooks. */
function mapToolCall(toolCall) {
  if (!isPlainObject(toolCall)) return {};
  const name = presentString(toolCall.name) || "";
  const args = isPlainObject(toolCall.args) ? toolCall.args : {};
  if (name === "run_command") {
    return {
      tool_name: "Bash",
      tool_input: { command: args.CommandLine ?? args.command ?? "" },
    };
  }
  if (name === "write_file" || name === "write_to_file") {
    return {
      tool_name: "Write",
      tool_input: {
        ...fileTargets(args, name === "write_file" ? "Path" : "TargetFile"),
        content: args.Content ?? args.CodeContent ?? "",
      },
    };
  }
  if (
    name === "edit_file" ||
    name === "replace_file_content" ||
    name === "multi_replace_file_content"
  ) {
    const nativeEdit = name === "edit_file";
    const targets = fileTargets(args, nativeEdit ? "Path" : "TargetFile");
    const chunks = nativeEdit ? args.Edits : args.ReplacementChunks;
    if (Array.isArray(chunks) || name === "multi_replace_file_content") {
      return {
        tool_name: "MultiEdit",
        tool_input: {
          ...targets,
          edits: Array.isArray(chunks) ? chunks.map((chunk) => replacementFields(chunk, nativeEdit)) : [],
        },
      };
    }
    return {
      tool_name: "Edit",
      tool_input: { ...targets, ...replacementFields(args, nativeEdit) },
    };
  }
  return { tool_name: name, tool_input: args };
}

/** Normalize an AGY stdin object for a given Bearing hook target. */
function adaptInput(rawInput, target) {
  if (!isPlainObject(rawInput)) return rawInput;
  const sessionId =
    presentString(rawInput.session_id) ||
    presentString(rawInput.sessionId) ||
    presentString(rawInput.conversation_id) ||
    presentString(rawInput.conversationId);
  const cwd =
    presentString(rawInput.cwd) ||
    presentString(rawInput.workspaceRoot) ||
    (Array.isArray(rawInput.workspacePaths) ? presentString(rawInput.workspacePaths[0]) : undefined);
  const hookEventName =
    presentString(rawInput.hook_event_name) || presentString(rawInput.hookEventName);
  const adapted = {
    ...rawInput,
    ...(sessionId ? { session_id: sessionId, conversation_id: sessionId } : {}),
    ...(cwd ? { cwd, workspaceRoot: cwd } : {}),
    ...(hookEventName ? { hook_event_name: hookEventName, hookEventName } : {}),
  };
  if ([rawInput.continuationActive, rawInput.continuation_active]
    .some((value) => [true, "true", 1, "1"].includes(value))) {
    adapted.stop_hook_active = true;
  }

  if (isPlainObject(rawInput.toolCall)) {
    if (target === "assurance-dispatch") {
      adapted.tool_name = presentString(rawInput.toolCall.name) || "";
      adapted.tool_input = isPlainObject(rawInput.toolCall.args) ? rawInput.toolCall.args : {};
    } else {
      Object.assign(adapted, mapToolCall(rawInput.toolCall));
    }
  }
  return adapted;
}

function toAgySessionStart(response) {
  const text = response?.hookSpecificOutput?.additionalContext;
  if (typeof text === "string" && text) {
    return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
  }
  return {};
}

function toAgyPreToolUse(wireResponse) {
  const inner = isPlainObject(wireResponse?.hookSpecificOutput)
    ? wireResponse.hookSpecificOutput
    : {};
  if (inner.permissionDecision === "deny") {
    return {
      decision: "deny",
      reason: inner.permissionDecisionReason || "denied by Bearing Lite hook",
    };
  }
  if (typeof inner.additionalContext === "string" && inner.additionalContext) {
    return { decision: "allow", reason: inner.additionalContext };
  }
  return { decision: "allow" };
}

function toAgyStop(response) {
  if (response && response.decision === "block") {
    return {
      decision: "continue",
      reason: response.reason || "Hook requested the turn continue.",
    };
  }
  return {};
}

async function runTarget(target, rawText, enteredAt) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    return target === "assurance-dispatch" || target === "te-write" || target === "orchestrator-write-lock"
      ? { decision: "allow" }
      : {};
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return target === "assurance-dispatch" || target === "te-write" || target === "orchestrator-write-lock"
      ? { decision: "allow" }
      : {};
  }
  const adapted = adaptInput(parsed, target);

  if (target === "activation") {
    let response = claudeHost.handle(adapted, { host: "agy" });
    try {
      response = await claudeHost.applyAdapter(adapted, response, enteredAt, { host: "agy" });
    } catch {
      // Fail open on advisory decision adapter errors.
    }
    const out = toAgySessionStart(response);
    process.stderr.write(JSON.stringify({ hookClass: "activation", host: "agy", injected: Boolean(out.injectSteps) }) + "\n");
    return out;
  }

  if (target === "closeout") {
    let response = claudeHost.handle(adapted, { host: "agy" });
    try {
      response = await claudeHost.applyAdapter(adapted, response, enteredAt, { host: "agy" });
    } catch {
      // Fail open on advisory decision adapter errors.
    }
    const out = toAgyStop(cursorStop.quietAdvice(response));
    process.stderr.write(JSON.stringify({ hookClass: "closeout", host: "agy", decision: out.decision || "allow" }) + "\n");
    return out;
  }

  if (target === "git-sync") {
    // Advisory Stop stays quiet on AGY (same as Claude/Codex) so the turn terminates.
    const r = gitSync.handle(adapted);
    process.stderr.write(JSON.stringify({ hookClass: "git_sync", host: "agy", quiet: !r || Object.keys(r).length === 0 }) + "\n");
    return {};
  }

  if (target === "assurance-dispatch") {
    const r = assuranceDispatch.handle(adapted, "agy");
    process.stderr.write(JSON.stringify(r) + "\n");
    return toAgyPreToolUse(assuranceDispatch.toWire(r, "agy"));
  }

  if (target === "te-write" || target === "te-completion") {
    const r = teHost.handle(adapted, {
      selected: flag(process.env.BEARING_TEST_ENGINEERING_SELECTED),
      required: flag(process.env.BEARING_TEST_ENGINEERING_REQUIRED),
      host: "agy",
    });
    process.stderr.write(JSON.stringify(r) + "\n");
    const wire = teHost.toWire(r);
    return target === "te-write" ? toAgyPreToolUse(wire) : toAgyStop(wire);
  }

  if (target === "orchestrator-write-lock") {
    const r = writeLock.handle(adapted, {
      host: "agy",
      role: process.env.BEARING_ROLE,
    });
    process.stderr.write(JSON.stringify(r) + "\n");
    return toAgyPreToolUse(writeLock.toWire(r));
  }

  return {};
}

async function main() {
  const enteredAt = performance.now();
  const target = process.argv[2] || "";
  let out = {};
  try {
    const raw = readStdinSync();
    out = await runTarget(target, raw, enteredAt);
  } catch {
    out =
      target === "assurance-dispatch" || target === "te-write" || target === "orchestrator-write-lock"
        ? { decision: "allow" }
        : {};
  }
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}

module.exports = { adaptInput, mapToolCall, toAgySessionStart, toAgyPreToolUse, toAgyStop, runTarget };

if (require.main === module) {
  main();
}

"use strict";

/**
 * Cursor stop wire. Advice stays additional_context. followup_message
 * auto-submits a user turn, so it is only for a hook that asks to continue
 * (decision "block"). continue:false is a stop, not a follow-up.
 */

function textOf(body) {
  const inner = body.hookSpecificOutput;
  const nested = inner && typeof inner === "object" ? inner : {};
  for (const value of [
    nested.additionalContext,
    nested.reason,
    body.reason,
    body.systemMessage,
    body.stopReason,
  ]) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function eventName(body) {
  const inner = body.hookSpecificOutput;
  const nested = inner && typeof inner === "object" ? inner : {};
  return String(nested.hookEventName || body.hookEventName || "")
    .replace(/[_\-\s]/g, "")
    .toLowerCase();
}

function asksToContinue(body) {
  const inner = body.hookSpecificOutput;
  return body.decision === "block" || (inner && typeof inner === "object" && inner.decision === "block");
}

function project(body) {
  if (!body || typeof body !== "object") return body;
  const event = eventName(body);
  if (event !== "stop" && event !== "subagentstop") return body;
  const text = textOf(body);
  if (asksToContinue(body)) {
    return { followup_message: text || "Hook requested the turn continue." };
  }
  if (!text) return {};
  return { additional_context: text };
}

function usesCursorStop(argv) {
  return (argv || process.argv).includes("--host=cursor");
}

module.exports = { project, usesCursorStop };

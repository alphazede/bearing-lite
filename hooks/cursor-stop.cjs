"use strict";

/**
 * Stop wire. Advice must not start another turn.
 * Cursor keeps it as additional_context and uses followup_message only when
 * the hook asks to continue. Claude, Codex, Grok, Kimi, and Copilot have no
 * stop field that carries advice without continuing, so advice is omitted
 * and decision "block" is the only continue request.
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

function quietAdvice(body) {
  if (!body || typeof body !== "object") return body;
  const event = eventName(body);
  if (event !== "stop" && event !== "subagentstop") return body;
  if (!asksToContinue(body)) return {};
  const text = textOf(body);
  return { decision: "block", reason: text || "Hook requested the turn continue." };
}

function usesCursorStop(argv) {
  return (argv || process.argv).includes("--host=cursor");
}

function projectStop(body, argv) {
  return usesCursorStop(argv) ? project(body) : quietAdvice(body);
}

module.exports = { project, quietAdvice, usesCursorStop, projectStop };

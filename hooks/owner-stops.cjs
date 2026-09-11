"use strict";

// Procedural owner-stop preflight and local receipt metrics; never grants authority.
const fs = require("node:fs");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const classes = ["A", "B", "C", "D", "E", "F"];
const exclusions = ["scope_change", "budget_exhaustion", "owner_hold", "owner_only_actions"];

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("invalid_utc_timestamp");
  }
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    throw new Error("invalid_utc_timestamp");
  }
  return n;
}

function evaluateOwnerStop(input) {
  const unknown = (reason) => ({ disposition: "NEEDS_MORE_EVIDENCE", reason });
  if (!object(input) || !classes.includes(input.class) || typeof input.blocking !== "boolean" || !text(input.evidence_ref)) {
    return unknown("owner_stop_input_missing");
  }
  if (["C", "E", "F"].includes(input.class)) {
    return { disposition: input.blocking ? "ASK" : "QUEUE", reason: "owner_boundary" };
  }
  const a = input.authority;
  const grant = a?.continuation;
  if (!object(a) || a.effective !== true || a.state !== "active" || !text(a.id) ||
      !object(a.approval_receipt) || Object.keys(a.approval_receipt).length === 0 ||
      !object(grant) || grant.granted !== true || !text(grant.owner_decision_id) ||
      !Array.isArray(a.granting_owner_decisions) || !a.granting_owner_decisions.includes(grant.owner_decision_id) ||
      !Array.isArray(a.expiry_conditions) || !a.expiry_conditions.length || !a.expiry_conditions.every(text) ||
      !Array.isArray(grant.exclusions) || !exclusions.every((item) => grant.exclusions.includes(item))) {
    return unknown("continuation_grant_missing");
  }
  try {
    const now = timestamp(input.checked_at);
    if (grant.expires_at !== null && timestamp(grant.expires_at) <= now) return unknown("continuation_expired");
  } catch {
    return unknown("continuation_expiry_unverified");
  }
  const checks = ["scope", "budget", "exclusions", "expiry", "owner_hold"];
  if (input.class === "A") checks.push("policy");
  if (input.class === "B") checks.push("fallback");
  if (!object(input.checks) || !checks.every((key) => input.checks[key] === true) || !text(input.resolution_ref)) {
    return unknown("continuation_conditions_unverified");
  }
  return { disposition: "CONTINUE", reason: "approved_resolution", authority_id: a.id };
}

function unionLength(intervals) {
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of intervals.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}

function ownerWaitMetrics(journey, asOf) {
  if (!object(journey)) throw new Error("journey_missing");
  if (journey.owner_wait_tracking === undefined || journey.owner_wait_tracking === false) {
    return { status: "unavailable", reason: "owner_wait_not_tracked" };
  }
  if (journey.owner_wait_tracking !== true || !Array.isArray(journey.decisions) ||
      !Array.isArray(journey.open_decisions) || !Array.isArray(journey.owner_blocked_intervals)) {
    throw new Error("owner_wait_records_missing");
  }
  const now = timestamp(asOf);
  const counts = Object.fromEntries(classes.map((key) => [key, 0]));
  const metrics = { status: "measured", as_of: asOf, decisions_asked: 0, round_trips: 0,
    queued: 0, pending: 0, cancelled: 0, by_class: counts,
    response_ms: 0, pending_response_ms: 0, response_window_ms: 0, blocked_ms: 0 };
  const ids = new Set();
  const rounds = new Map();
  const responses = [];
  const windows = new Map();
  for (const q of [...journey.decisions, ...journey.open_decisions]) {
    if (!object(q) || q.record_type !== "owner_stop") continue;
    if (!text(q.id) || ids.has(q.id)) throw new Error("duplicate_or_missing_decision_id");
    ids.add(q.id);
    if (!classes.includes(q.class) || !["queued", "asked", "answered", "cancelled"].includes(q.status) ||
        !text(q.question) || !text(q.evidence_ref) || !text(q.why_owner) ||
        typeof q.blocking !== "boolean" || !Array.isArray(q.affected_slices) || !q.affected_slices.every(text) ||
        !["asked_at", "answered_at", "cancelled_at", "round_trip_id"].every((key) => Object.hasOwn(q, key))) {
      throw new Error("invalid_owner_stop_record");
    }
    const asked = q.asked_at === null ? null : timestamp(q.asked_at);
    const answered = q.answered_at === null ? null : timestamp(q.answered_at);
    const cancelled = q.cancelled_at === null ? null : timestamp(q.cancelled_at);
    const created = timestamp(q.created_at);
    if (created > now || (asked !== null && (asked < created || asked > now))) throw new Error("invalid_question_time");
    if (q.status === "queued" && (asked !== null || answered !== null || cancelled !== null)) throw new Error("invalid_queued_question");
    if (q.status === "asked" && (asked === null || answered !== null || cancelled !== null)) throw new Error("invalid_pending_question");
    if (q.status === "answered" && (asked === null || answered === null || cancelled !== null || !text(q.answer_ref))) throw new Error("invalid_answered_question");
    if (q.status === "cancelled" && (cancelled === null || answered !== null)) throw new Error("invalid_cancelled_question");
    const end = answered ?? cancelled ?? now;
    if (end < (asked ?? created) || end > now) throw new Error("invalid_response_time");
    if (q.status === "queued") metrics.queued++;
    if (q.status === "asked") metrics.pending++;
    if (q.status === "cancelled") metrics.cancelled++;
    if (asked === null) {
      if (q.round_trip_id !== null) throw new Error("unasked_round_trip");
      continue;
    }
    if (!text(q.round_trip_id)) throw new Error("round_trip_missing");
    if (rounds.has(q.round_trip_id) && rounds.get(q.round_trip_id) !== asked) {
      throw new Error("inconsistent_round_trip_time");
    }
    rounds.set(q.round_trip_id, asked);
    metrics.decisions_asked++;
    counts[q.class]++;
    responses.push([asked, end]);
    windows.set(q.id, [asked, end]);
    if (answered !== null) metrics.response_ms += end - asked;
    if (q.status === "asked") metrics.pending_response_ms += now - asked;
  }
  const blocked = [];
  for (const interval of journey.owner_blocked_intervals) {
    if (!object(interval) || !Array.isArray(interval.decision_ids) || !interval.decision_ids.length ||
        !interval.decision_ids.every(text) || new Set(interval.decision_ids).size !== interval.decision_ids.length ||
        !Object.hasOwn(interval, "ended_at")) throw new Error("invalid_blocked_interval");
    const start = timestamp(interval.started_at);
    const end = interval.ended_at === null ? now : timestamp(interval.ended_at);
    if (start > end || end > now) throw new Error("invalid_blocked_time");
    for (const id of interval.decision_ids) {
      const window = windows.get(id);
      if (!window || start < window[0] || end > window[1]) throw new Error("blocked_interval_outside_question");
    }
    blocked.push([start, end]);
  }
  metrics.round_trips = rounds.size;
  metrics.response_window_ms = unionLength(responses);
  metrics.blocked_ms = unionLength(blocked);
  return metrics;
}

module.exports = { evaluateOwnerStop, ownerWaitMetrics };

if (require.main === module) {
  try {
    const [file, asOf] = process.argv.slice(2);
    if (!file || !asOf) throw new Error("usage: owner-stops.cjs <journey.json> <as-of-UTC>");
    console.log(JSON.stringify(ownerWaitMetrics(JSON.parse(fs.readFileSync(file, "utf8")), asOf)));
  } catch (error) {
    console.log(JSON.stringify({ status: "invalid", reason: error.code ? "journey_unreadable" :
      /^[a-z_]+$/.test(error.message) ? error.message : "invalid_journey_input" }));
    process.exitCode = 1;
  }
}

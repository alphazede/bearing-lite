"use strict";

const { update, read: readJson } = require("./assurance-budget-store.cjs");
const crypto = require("node:crypto");

function same(assignment, key) {
  return assignment.journey === key.journey && assignment.wave === key.wave &&
    assignment.slice === key.slice && assignment.role === key.role;
}
function find(record, key) {
  const list = record.dispatches && Array.isArray(record.dispatches.assignments) ? record.dispatches.assignments : [];
  return list.find(assignment => key && same(assignment, key)) || null;
}
function latest(assignment) {
  return assignment.attempts[assignment.attempts.length - 1] || null;
}
function brief(attempt) {
  return attempt ? { attempt_id: attempt.attempt_id, attempt: attempt.attempt } : undefined;
}
function hold(assignment, reason) {
  const attempt = latest(assignment);
  const result = { outcome: "HOLD", state: assignment ? assignment.state : "READY", reason };
  if (attempt && !attempt.closed) result.attempt = brief(attempt);
  return result;
}
function gap(state, reason) {
  return { outcome: "IDENTITY_GAP", state, reason };
}
function ok(assignment, attempt) {
  return { outcome: "PASS", state: assignment.state, attempt: brief(attempt) };
}
function counts(value) {
  return !!value && Number.isSafeInteger(value.invocation) && Number.isSafeInteger(value.review) && Number.isSafeInteger(value.repair);
}
function pushAttempt(assignment, event) {
  const attempt = {
    attempt_id: crypto.randomUUID(),
    attempt: assignment.attempts.length + 1,
    route: event.route,
    candidate_revision: event.candidate_revision,
    launch_digest: event.launch_digest,
    closed: false,
    lease_generation: event.lease.generation,
    lease_branch: event.lease.branch,
  };
  assignment.attempts.push(attempt);
  return attempt;
}
function routeAllowed(assignment, route) {
  const last = latest(assignment);
  if (route === last.route) return true;
  if (!assignment.fallback_authorized) return false;
  const at = assignment.routes.indexOf(last.route);
  return at >= 0 && assignment.routes[at + 1] === route;
}
function openMatch(assignment, event) {
  const attempt = latest(assignment);
  if (!attempt || attempt.closed || attempt.attempt_id !== event.attempt_id) return null;
  return attempt;
}
function identityProblem(attempt, event) {
  if (event.candidate_revision !== attempt.candidate_revision) return "candidate revision mismatch";
  const lease = event.lease || {};
  if (lease.generation !== attempt.lease_generation) return "lease generation mismatch";
  if (lease.branch !== attempt.lease_branch) return "lease branch mismatch";
  if (lease.active === false) return "lease inactive";
  return "";
}
function reserve(record, event) {
  const key = event.key || {};
  const refused = hold(find(record, key) || { state: "READY", attempts: [] }, "reservation refused");
  if (event.authorized !== true || !key.journey || !key.wave || !key.slice || !key.role) return refused;
  if (!event.candidate_revision || typeof event.route !== "string" || !Array.isArray(event.routes) || !event.routes.includes(event.route)) return refused;
  if (!event.lease || !Number.isSafeInteger(event.lease.generation) || typeof event.lease.branch !== "string") return refused;
  if (!counts(event.limits) || typeof event.launch_digest !== "string" || !event.launch_digest) return refused;
  const assignment = find(record, key);
  if (!assignment) {
    const created = {
      journey: key.journey,
      wave: key.wave,
      slice: key.slice,
      role: key.role,
      generation: key.generation,
      state: "RESERVED",
      spent: { invocation: 1, review: 0, repair: 0 },
      limits: { invocation: event.limits.invocation, review: event.limits.review, repair: event.limits.repair },
      routes: event.routes.slice(),
      fallback_authorized: false,
      receipts: [],
      attempts: [],
    };
    const attempt = pushAttempt(created, event);
    if (!record.dispatches || typeof record.dispatches !== "object" || Array.isArray(record.dispatches)) record.dispatches = {};
    if (!Array.isArray(record.dispatches.assignments)) record.dispatches.assignments = [];
    record.dispatches.assignments.push(created);
    return ok(created, attempt);
  }
  if (assignment.state !== "RECOVERABLE") return hold(assignment, "open writer");
  if (!routeAllowed(assignment, event.route)) return hold(assignment, "frozen route");
  const attempt = pushAttempt(assignment, event);
  assignment.state = "RESERVED";
  assignment.generation = key.generation;
  assignment.fallback_authorized = false;
  return ok(assignment, attempt);
}
function attach(assignment, event) {
  const attempt = openMatch(assignment, event);
  if (!attempt || assignment.state !== "RESERVED" || !event.host_session_id) return hold(assignment, "not reserved");
  attempt.host_session_id = event.host_session_id;
  assignment.state = "DISPATCHED";
  return ok(assignment, attempt);
}
function launchFailed(assignment, event) {
  const attempt = openMatch(assignment, event);
  if (!attempt || assignment.state !== "RESERVED") return hold(assignment, "not reserved");
  const proof = event.proof;
  const proven = !!proof && proof.no_session === true && proof.no_process === true;
  if (!proven) {
    assignment.state = "HELD";
    return ok(assignment, attempt);
  }
  attempt.closed = true;
  assignment.state = "RECOVERABLE";
  assignment.fallback_authorized = typeof event.unavailable_condition === "string" && event.unavailable_condition.length > 0;
  return ok(assignment, attempt);
}
function interrupted(assignment, event) {
  const attempt = openMatch(assignment, event);
  if (!attempt || assignment.state !== "RESERVED") return hold(assignment, "not reserved");
  assignment.state = "HELD";
  return ok(assignment, attempt);
}
function disconnect(assignment, event) {
  const attempt = openMatch(assignment, event);
  if (!attempt || assignment.state !== "DISPATCHED") return hold(assignment, "not dispatched");
  assignment.state = "CHECKING";
  return ok(assignment, attempt);
}
function complete(assignment, attempt, eventId) {
  attempt.closed = true;
  assignment.state = "COMPLETED";
  if (eventId && !assignment.receipts.includes(eventId)) assignment.receipts.push(eventId);
  return ok(assignment, attempt);
}
function receipt(assignment, event) {
  const attempt = assignment.attempts.find(item => item.attempt_id === event.attempt_id);
  if (!attempt) return hold(assignment, "unknown attempt");
  if (event.candidate_revision !== attempt.candidate_revision) return gap(assignment.state, "candidate revision mismatch");
  if (assignment.state === "COMPLETED" && assignment.receipts.includes(event.event_id)) {
    return { outcome: "NO_OP", state: "COMPLETED" };
  }
  const current = latest(assignment);
  if (attempt !== current || attempt.closed || (assignment.state !== "DISPATCHED" && assignment.state !== "CHECKING")) {
    return hold(assignment, "stale receipt");
  }
  return complete(assignment, attempt, event.event_id);
}
function check(assignment, event) {
  const attempt = latest(assignment);
  if (!attempt || attempt.attempt_id !== event.attempt_id) return hold(assignment, "unknown attempt");
  const problem = identityProblem(attempt, event);
  if (problem) return gap(assignment.state, problem);
  if (assignment.state === "COMPLETED") return { outcome: "NO_OP", state: "COMPLETED" };
  if (attempt.closed) return hold(assignment, "closed attempt");
  const receiptId = event.receipt && event.receipt.event_id;
  if (receiptId) {
    if (event.receipt.candidate_revision && event.receipt.candidate_revision !== attempt.candidate_revision) {
      return gap(assignment.state, "candidate revision mismatch");
    }
    if (assignment.state === "CHECKING" || assignment.state === "HELD" || assignment.state === "DISPATCHED") {
      return complete(assignment, attempt, receiptId);
    }
  }
  const dead = event.liveness === "EXITED" || event.liveness === "INACTIVE";
  const bound = !!attempt.host_session_id;
  if (assignment.state === "CHECKING" && event.liveness === "RUNNING" && bound) {
    assignment.state = "DISPATCHED";
    return ok(assignment, attempt);
  }
  if (dead && event.exclusive_ownership === true && bound && (assignment.state === "CHECKING" || assignment.state === "HELD")) {
    attempt.closed = true;
    assignment.state = "RECOVERABLE";
    return ok(assignment, attempt);
  }
  if (assignment.state === "CHECKING") {
    assignment.state = "HELD";
    return ok(assignment, attempt);
  }
  return hold(assignment, "held");
}
function admit(assignment, event) {
  const kind = event.kind;
  if (kind !== "review" && kind !== "repair") return hold(assignment, "unknown admission");
  if (assignment.spent[kind] >= assignment.limits[kind]) {
    return { outcome: "REFUSED", state: assignment.state, reason: `${kind} allowance spent` };
  }
  assignment.spent[kind] += 1;
  return ok(assignment, latest(assignment));
}
function apply(record, event) {
  if (!event || typeof event !== "object") return { outcome: "HOLD", state: "READY", reason: "event" };
  if (event.type === "reserve") return reserve(record, event);
  const assignment = find(record, event.key);
  if (!assignment) return { outcome: "HOLD", state: "READY", reason: "no assignment" };
  if (event.type === "attach") return attach(assignment, event);
  if (event.type === "launch_failed") return launchFailed(assignment, event);
  if (event.type === "interrupted") return interrupted(assignment, event);
  if (event.type === "disconnect") return disconnect(assignment, event);
  if (event.type === "check") return check(assignment, event);
  if (event.type === "receipt") return receipt(assignment, event);
  if (event.type === "admit") return admit(assignment, event);
  return hold(assignment, "unknown event");
}
function publicAttempt(attempt) {
  const out = {
    attempt_id: attempt.attempt_id,
    attempt: attempt.attempt,
    route: attempt.route,
    candidate_revision: attempt.candidate_revision,
    launch_digest: attempt.launch_digest,
    closed: !!attempt.closed,
  };
  if (attempt.host_session_id) out.host_session_id = attempt.host_session_id;
  return out;
}
function read(file, key) {
  const assignment = find(readJson(file), key);
  if (!assignment) {
    return {
      state: "READY",
      attempts: [],
      spent: { invocation: 0, review: 0, repair: 0 },
      limits: { invocation: 0, review: 0, repair: 0 },
    };
  }
  return {
    state: assignment.state,
    attempts: assignment.attempts.map(publicAttempt),
    spent: { invocation: assignment.spent.invocation, review: assignment.spent.review, repair: assignment.spent.repair },
    limits: { invocation: assignment.limits.invocation, review: assignment.limits.review, repair: assignment.limits.repair },
  };
}
function transition(file, event) {
  return update({ task_record_path: file }, record => apply(record, event));
}

module.exports = { transition, read };

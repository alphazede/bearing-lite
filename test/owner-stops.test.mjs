import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { evaluateOwnerStop, ownerWaitMetrics } = require("../hooks/owner-stops.cjs");
const transition = require("../hooks/transition-order.cjs");
const closeout = require("../hooks/closeout.cjs");
const at = (minute) => `2026-09-11T10:${String(minute).padStart(2, "0")}:00Z`;
const authority = () => ({ id: "AUTH-1", state: "active", effective: true,
  granting_owner_decisions: ["DEC-1"], approval_receipt: { ref: "approval-1" },
  expiry_conditions: ["owner revokes or supersedes"], continuation: {
    granted: true, owner_decision_id: "DEC-1", expires_at: null,
    exclusions: ["scope_change", "budget_exhaustion", "owner_hold", "owner_only_actions"],
  } });
const preflight = (category = "D") => ({ class: category, blocking: true,
  evidence_ref: "candidate-1", resolution_ref: "resolution-1", checked_at: at(0),
  authority: authority(), checks: { scope: true, budget: true, exclusions: true,
    expiry: true, owner_hold: true, policy: true, fallback: true } });
const question = (id, overrides = {}) => ({ record_type: "owner_stop", id,
  class: "F", status: "answered", question: "Authorize the named action?",
  why_owner: "Action excluded by the envelope", evidence_ref: "authority-1",
  blocking: true, affected_slices: ["S1"], created_at: at(0),
  asked_at: at(1), answered_at: at(10), cancelled_at: null,
  round_trip_id: "batch-1", answer_ref: "answer-1", ...overrides });
const journey = (...questions) => ({ owner_wait_tracking: true, decisions: questions,
  open_decisions: [], owner_blocked_intervals: [] });

describe("owner stop preflight", () => {
  it("resolves A/B/D only within the explicit continuation grant", () => {
    for (const c of ["A", "B", "D"]) assert.equal(evaluateOwnerStop(preflight(c)).disposition, "CONTINUE");
    for (const change of [
      (x) => delete x.authority.continuation,
      (x) => x.authority.continuation.granted = false,
      (x) => x.authority.effective = false,
      (x) => x.authority.state = "revoked",
      (x) => x.authority.granting_owner_decisions = ["other"],
      (x) => x.authority.approval_receipt = {},
      (x) => x.authority.expiry_conditions = [],
      (x) => x.authority.continuation.exclusions = [],
      (x) => x.authority.continuation.expires_at = at(0),
      (x) => delete x.authority.continuation.expires_at,
      (x) => x.authority.continuation.expires_at = "2026-02-30T00:00:00Z",
      (x) => delete x.resolution_ref,
    ]) {
      const input = preflight(); change(input);
      assert.equal(evaluateOwnerStop(input).disposition, "NEEDS_MORE_EVIDENCE");
    }
  });
  it("does not treat missing, false or string flags as verified evidence", () => {
    for (const c of ["A", "B", "D"]) {
      for (const key of ["scope", "budget", "exclusions", "expiry", "owner_hold", ...(c === "A" ? ["policy"] : c === "B" ? ["fallback"] : [])]) {
        for (const value of [undefined, false, "true"]) {
          const input = preflight(c); input.checks[key] = value;
          assert.equal(evaluateOwnerStop(input).disposition, "NEEDS_MORE_EVIDENCE", `${c}/${key}/${value}`);
        }
      }
    }
  });
  it("asks blocking C/E/F and queues only nonblocking questions", () => {
    for (const c of ["C", "E", "F"]) {
      assert.equal(evaluateOwnerStop({ class: c, evidence_ref: "boundary", blocking: true }).disposition, "ASK");
      assert.equal(evaluateOwnerStop({ class: c, evidence_ref: "boundary", blocking: false }).disposition, "QUEUE");
    }
    assert.equal(evaluateOwnerStop({ class: "F", blocking: "false" }).disposition, "NEEDS_MORE_EVIDENCE");
  });
  it("uses the existing procedural transition adapter without granting dispatch", () => {
    const result = transition.evaluate({ action_kind: "owner_stop_check", owner_stop: preflight() });
    assert.equal(result.outcome, "ADVISE");
    assert.equal(result.enforcement, "procedural");
    assert.equal(closeout.evaluate({ action_kind: "owner_wait_summary", protected_completion: true,
      journey: journey(), as_of: at(12) }).outcome, "UNAVAILABLE");
    assert.equal(result.owner_stop.disposition, "CONTINUE");
    assert.equal(transition.evaluate({ action_kind: "owner_stop_check" }).outcome, "UNAVAILABLE");
    assert.equal(transition.evaluate({ channel: "owner_communication", action_kind: "owner_stop_check" }).reason, "channel_open");
  });
});

describe("local owner wait metrics", () => {
  it("separates response totals, wall time, batches and fully blocked intervals", () => {
    const doc = journey(question("Q1"), question("Q2", { round_trip_id: "batch-2", asked_at: at(3), answered_at: at(12) }));
    doc.owner_blocked_intervals = [
      { decision_ids: ["Q1"], started_at: at(4), ended_at: at(8) },
      { decision_ids: ["Q2"], started_at: at(6), ended_at: at(9) },
    ];
    const before = JSON.stringify(doc);
    const m = ownerWaitMetrics(doc, at(15));
    assert.equal(m.decisions_asked, 2);
    assert.equal(m.round_trips, 2);
    assert.equal(m.by_class.F, 2);
    assert.equal(m.response_ms, 18 * 60000);
    assert.equal(m.response_window_ms, 11 * 60000);
    assert.equal(m.blocked_ms, 5 * 60000);
    assert.equal(JSON.stringify(doc), before, "read-only evaluator");
  });
  it("counts queued, cancelled and pending records without inventing answers", () => {
    const doc = journey(question("Q1", { status: "asked", answered_at: null }),
      question("Q2", { status: "queued", asked_at: null, answered_at: null, round_trip_id: null }),
      question("Q3", { status: "cancelled", answered_at: null, cancelled_at: at(5) }));
    const m = ownerWaitMetrics(doc, at(12));
    assert.equal(m.decisions_asked, 2);
    assert.equal(m.queued, 1); assert.equal(m.pending, 1); assert.equal(m.cancelled, 1);
    assert.equal(m.response_ms, 0);
    assert.equal(m.pending_response_ms, 11 * 60000);
    assert.equal(m.response_window_ms, 11 * 60000);
  });
  it("rejects duplicate projections, backwards/future/impossible dates and unanswered completion", () => {
    assert.throws(() => ownerWaitMetrics(journey(question("Q1"), question("Q1")), at(15)), /duplicate/);
    assert.throws(() => ownerWaitMetrics(journey(question("Q1"), question("Q2", { asked_at: at(3) })), at(15)), /round_trip_time/);
    assert.equal(ownerWaitMetrics(journey(question("Q1"), question("Q2")), at(15)).round_trips, 1);
    for (const changes of [
      { answered_at: at(0) }, { asked_at: at(20) }, { answered_at: at(20) },
      { asked_at: "2026-02-30T00:00:00Z" }, { asked_at: "2026-09-11T10:01:00" },
      { status: "asked" }, { status: "queued" }, { status: "cancelled" },
      { answer_ref: "" }, { round_trip_id: null }, { asked_at: null },
    ]) assert.throws(() => ownerWaitMetrics(journey(question("Q1", changes)), at(15)));
  });
  it("rejects blocking outside an actual question interval and clips pending waits at as-of", () => {
    const doc = journey(question("Q1", { status: "asked", answered_at: null }));
    doc.owner_blocked_intervals = [{ decision_ids: ["Q1"], started_at: at(5), ended_at: null }];
    assert.equal(ownerWaitMetrics(doc, at(12)).blocked_ms, 7 * 60000);
    doc.owner_blocked_intervals[0].decision_ids = ["unknown"];
    assert.throws(() => ownerWaitMetrics(doc, at(12)), /outside_question/);
    doc.owner_blocked_intervals[0] = { decision_ids: ["Q1"], started_at: at(0), ended_at: at(3) };
    assert.throws(() => ownerWaitMetrics(doc, at(12)), /outside_question/);
  });
  it("reports legacy coverage as unavailable and integrates with explicit closeout invocation", () => {
    assert.equal(ownerWaitMetrics({}, at(12)).status, "unavailable");
    assert.throws(() => ownerWaitMetrics({ owner_wait_tracking: true }, at(12)), /records_missing/);
    const result = closeout.evaluate({ action_kind: "owner_wait_summary", journey: journey(), as_of: at(12) });
    assert.equal(result.owner_wait.decisions_asked, 0);
    assert.equal(result.enforcement, "procedural");
    assert.equal(closeout.evaluate({ action_kind: "owner_wait_summary", journey: journey(), as_of: "bad" }).outcome, "UNAVAILABLE");
  });
});

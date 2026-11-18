// S07T (Bearing 3.0, W2): dispatch record and recovery decision (N05, DES-F07).
// Oracle: boundary contract SM03 / TB06 / F07 (sha256 568a2121...), SEIT-B30-115,
// SEIT-B30-122, SEIT-SM03-T, SEIT-SM03-X, SEIT-TB06-N, SEIT-F07; DEC-16.
//
// Public entry points this file binds (hooks/dispatch-record.cjs):
//   transition(journeyFile, event) -> { outcome, state, reason?, attempt? }
//     outcome: PASS (event applied and persisted) | NO_OP (idempotent replay)
//              | HOLD (refused; nothing written) | IDENTITY_GAP (named identity
//              mismatch; nothing written) | REFUSED (allowance spent; nothing
//              written) | NEEDS_MORE_EVIDENCE (store or lock unavailable)
//     state:   SM03 state of the logical assignment after the call
//     attempt: { attempt_id, attempt } of the open or latest attempt
//   read(journeyFile, key) -> { state, attempts: [{ attempt_id, attempt, route,
//     candidate_revision, launch_digest, host_session_id, closed }],
//     spent: { invocation, review, repair }, limits: { invocation, review, repair } }
// Records live in the journey record's `dispatches` field under the
// `<journeyFile>.lock` cross-process lock (design.md, OOPDSA ownership).
// Event types: reserve, attach, launch_failed, interrupted, disconnect, check,
// receipt, admit (see helpers below for fields).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const MODULE = path.join(ROOT, "hooks/dispatch-record.cjs");
// Loaded per test so a missing module fails each case by name (expected-red baseline).
const dr = () => require(MODULE);
const ready = () => require(path.join(ROOT, "hooks/ready-set.cjs"));

const KEY = Object.freeze({ journey: "J1", wave: "W2", slice: "S1", role: "implementer", generation: 1 });
const LIMITS = Object.freeze({ invocation: 2, review: 1, repair: 1 });
const LEASE = Object.freeze({ generation: 1, branch: "slice/s1", active: true });
const REV = "rev-a";

function journey(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "dispatch-record-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "journey.json");
  writeFileSync(file, JSON.stringify({ schema_version: 1, journey: "J1", unrelated: { keep: "me" } }, null, 2) + "\n");
  return file;
}
const apply = (file, event) => dr().transition(file, { key: KEY, ...event });
const bytes = (file) => readFileSync(file);
const reserve = (file, over = {}) =>
  apply(file, { type: "reserve", candidate_revision: REV, route: "primary", routes: ["primary", "fallback:1"],
    launch_digest: "d".repeat(64), lease: { generation: 1, branch: "slice/s1" }, limits: LIMITS, authorized: true, ...over });
const check = (file, attempt_id, over = {}) =>
  apply(file, { type: "check", attempt_id, liveness: "EXITED", exclusive_ownership: true, receipt: null,
    lease: LEASE, candidate_revision: REV, ...over });

function reserved(file) {
  const r = reserve(file);
  assert.equal(r.outcome, "PASS", JSON.stringify(r));
  return r.attempt.attempt_id;
}
function dispatched(file) {
  const id = reserved(file);
  const r = apply(file, { type: "attach", attempt_id: id, host_session_id: "sess-1" });
  assert.equal(r.state, "DISPATCHED", JSON.stringify(r));
  return id;
}
function checking(file) {
  const id = dispatched(file);
  const r = apply(file, { type: "disconnect", attempt_id: id });
  assert.equal(r.state, "CHECKING", JSON.stringify(r));
  return id;
}
function recoverable(file) {
  const id = checking(file);
  const r = check(file, id);
  assert.equal(r.state, "RECOVERABLE", JSON.stringify(r));
  return id;
}
function held(file) {
  const id = checking(file);
  const r = check(file, id, { liveness: "UNKNOWN", exclusive_ownership: false });
  assert.equal(r.state, "HELD", JSON.stringify(r));
  return id;
}
// A refusal leaves the owned record byte-identical and leaves no scratch state.
function assertRefused(file, before, result, outcome) {
  assert.notEqual(result.outcome, "PASS", JSON.stringify(result));
  if (outcome) assert.equal(result.outcome, outcome, JSON.stringify(result));
  assert.deepEqual(bytes(file), before);
  assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
}

describe("SM03 legal transitions (SEIT-SM03-T)", () => {
  it("SM03.T1 READY -> RESERVED persists durable attempt intent before launch", (t) => {
    const file = journey(t);
    const r = reserve(file);
    assert.equal(r.outcome, "PASS");
    assert.equal(r.state, "RESERVED");
    assert.equal(r.attempt.attempt, 1);
    const rec = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(rec.dispatches, "journey record carries the dispatches field");
    assert.deepEqual(rec.unrelated, { keep: "me" }, "unrelated journey fields preserved");
    const view = dr().read(file, KEY);
    assert.equal(view.state, "RESERVED");
    assert.equal(view.attempts.length, 1);
    assert.equal(view.attempts[0].route, "primary");
    assert.equal(view.attempts[0].candidate_revision, REV);
    assert.ok(!view.attempts[0].host_session_id, "unbound until attach");
  });

  it("SM03.T2 RESERVED -> DISPATCHED attaches the host session id", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    const view = dr().read(file, KEY);
    assert.equal(view.state, "DISPATCHED");
    assert.equal(view.attempts[0].attempt_id, id);
    assert.equal(view.attempts[0].host_session_id, "sess-1");
  });

  it("SM03.T3 verified no-launch failure with recorded unavailability -> RECOVERABLE; next ordered fallback allowed; budgets unchanged", (t) => {
    const file = journey(t);
    const id = reserved(file);
    const spent = dr().read(file, KEY).spent;
    const r = apply(file, { type: "launch_failed", attempt_id: id, proof: { no_session: true, no_process: true }, unavailable_condition: "quota" });
    assert.equal(r.state, "RECOVERABLE");
    assert.ok(dr().read(file, KEY).attempts[0].closed, "no-launch reservation closed");
    const next = reserve(file, { route: "fallback:1" });
    assert.equal(next.outcome, "PASS", JSON.stringify(next));
    assert.equal(next.attempt.attempt, 2);
    const view = dr().read(file, KEY);
    assert.equal(view.attempts[1].route, "fallback:1");
    assert.deepEqual(view.spent, spent);
  });

  it("SM03.T3 proven no-launch without recorded unavailability keeps the frozen route (generic failure is not fallback proof)", (t) => {
    const file = journey(t);
    const id = reserved(file);
    const r = apply(file, { type: "launch_failed", attempt_id: id, proof: { no_session: true, no_process: true } });
    assert.equal(r.state, "RECOVERABLE");
    const before = bytes(file);
    assertRefused(file, before, reserve(file, { route: "fallback:1" }));
    assert.equal(dr().read(file, KEY).state, "RECOVERABLE");
    const same = reserve(file, { route: "primary" });
    assert.equal(same.outcome, "PASS", JSON.stringify(same));
    assert.equal(dr().read(file, KEY).attempts[1].route, "primary");
  });

  it("SM03.T4 RESERVED -> HELD on interrupted or unknown launch; no duplicate launch", (t) => {
    for (const event of [{ type: "interrupted" }, { type: "launch_failed", proof: null }]) {
      const file = journey(t);
      const id = reserved(file);
      const r = apply(file, { ...event, attempt_id: id });
      assert.equal(r.state, "HELD", JSON.stringify(event));
      const before = bytes(file);
      assertRefused(file, before, reserve(file));
      const view = dr().read(file, KEY);
      assert.equal(view.attempts.length, 1);
      assert.ok(!view.attempts[0].host_session_id, "attempt stays unbound");
    }
  });

  it("SM03.T5 DISPATCHED -> COMPLETED on matching candidate receipt", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    const r = apply(file, { type: "receipt", attempt_id: id, event_id: "ev-1", candidate_revision: REV });
    assert.equal(r.outcome, "PASS");
    assert.equal(r.state, "COMPLETED");
    assert.equal(dr().read(file, KEY).state, "COMPLETED");
  });

  it("SM03.T6 DISPATCHED -> CHECKING on disconnect without receipt", (t) => {
    const file = journey(t);
    checking(file);
    assert.equal(dr().read(file, KEY).state, "CHECKING");
  });

  it("SM03.T7 CHECKING + RUNNING -> DISPATCHED keeps the current attempt", (t) => {
    const file = journey(t);
    const id = checking(file);
    const r = check(file, id, { liveness: "RUNNING" });
    assert.equal(r.state, "DISPATCHED");
    const view = dr().read(file, KEY);
    assert.equal(view.attempts.length, 1);
    assert.equal(view.attempts[0].attempt_id, id);
    assert.ok(!view.attempts[0].closed);
  });

  it("SM03.T8 CHECKING + durable completed receipt -> COMPLETED", (t) => {
    const file = journey(t);
    const id = checking(file);
    const r = check(file, id, { receipt: { event_id: "ev-1", candidate_revision: REV } });
    assert.equal(r.state, "COMPLETED");
  });

  it("SM03.T9 CHECKING + INACTIVE/EXITED + exclusive ownership + no receipt + valid lease -> RECOVERABLE", (t) => {
    for (const liveness of ["EXITED", "INACTIVE"]) {
      const file = journey(t);
      const id = checking(file);
      const spent = dr().read(file, KEY).spent;
      const r = check(file, id, { liveness });
      assert.equal(r.state, "RECOVERABLE", liveness);
      const view = dr().read(file, KEY);
      assert.ok(view.attempts[0].closed, "old attempt closed");
      assert.deepEqual(view.spent, spent);
      assert.deepEqual(view.limits, LIMITS);
    }
  });

  it("SM03.T10 CHECKING + UNKNOWN or missing ownership proof -> HELD", (t) => {
    for (const over of [{ liveness: "UNKNOWN" }, { liveness: "EXITED", exclusive_ownership: false }]) {
      const file = journey(t);
      const id = checking(file);
      const r = check(file, id, over);
      assert.equal(r.state, "HELD", JSON.stringify(over));
      assert.ok(!dr().read(file, KEY).attempts[0].closed, "unknown writer is not closed");
    }
  });

  it("SM03.T11 HELD -> RECOVERABLE when new evidence proves every recovery precondition", (t) => {
    const file = journey(t);
    const id = held(file);
    const r = check(file, id);
    assert.equal(r.state, "RECOVERABLE");
    assert.deepEqual(dr().read(file, KEY).limits, LIMITS);
  });

  it("SM03.T12 RECOVERABLE -> RESERVED reserves attempt n+1 for the same logical key", (t) => {
    const file = journey(t);
    const first = recoverable(file);
    const spent = dr().read(file, KEY).spent;
    const r = reserve(file);
    assert.equal(r.outcome, "PASS");
    assert.equal(r.state, "RESERVED");
    assert.equal(r.attempt.attempt, 2);
    assert.notEqual(r.attempt.attempt_id, first);
    const view = dr().read(file, KEY);
    assert.deepEqual(view.attempts.map((a) => a.attempt), [1, 2]);
    assert.deepEqual(view.spent, spent, "no expenditure refund");
  });
});

describe("recovery decision table (SEIT-B30-115)", () => {
  const rows = [
    ["a: exited proof, no receipt, valid lease, same candidate", {}, "RECOVERABLE"],
    ["b: liveness RUNNING", { liveness: "RUNNING" }, "DISPATCHED"],
    ["c: liveness UNKNOWN", { liveness: "UNKNOWN" }, "HELD"],
    ["d: completion receipt present", { receipt: { event_id: "ev-1", candidate_revision: REV } }, "COMPLETED"],
  ];
  for (const [name, over, state] of rows) {
    it(`row ${name} -> ${state}`, (t) => {
      const file = journey(t);
      const id = checking(file);
      const r = check(file, id, over);
      assert.equal(r.outcome, "PASS", JSON.stringify(r));
      assert.equal(r.state, state);
      const view = dr().read(file, KEY);
      if (state === "RECOVERABLE") {
        const next = reserve(file);
        assert.equal(next.outcome, "PASS");
        const after = dr().read(file, KEY);
        assert.deepEqual(after.attempts.map((a) => a.attempt), [1, 2], "attempt 2 on the same logical key");
      } else {
        assertRefused(file, bytes(file), reserve(file));
        assert.equal(dr().read(file, KEY).attempts.length, view.attempts.length);
      }
      if (state === "COMPLETED") {
        const before = bytes(file);
        const replay = check(file, id, over);
        assertRefused(file, before, replay, "NO_OP");
        assert.equal(replay.state, "COMPLETED", "completes once");
      }
    });
  }
  for (const [name, over, field] of [
    ["e: lease expired", { lease: { ...LEASE, active: false } }, /lease/],
    ["f: candidate revision changed", { candidate_revision: "rev-b" }, /candidate/],
  ]) {
    it(`row ${name} -> named identity gap, no transition`, (t) => {
      const file = journey(t);
      const id = checking(file);
      const before = bytes(file);
      const r = check(file, id, over);
      assertRefused(file, before, r, "IDENTITY_GAP");
      assert.match(r.reason, field);
      assert.equal(dr().read(file, KEY).state, "CHECKING");
    });
  }
});

describe("budgets stay on the logical assignment (SEIT-B30-122, B30-501)", () => {
  it("refuses invalid reservation and stale budget identity without changing the record", (t) => {
    const file = journey(t);
    const before = bytes(file);
    assertRefused(file, before, reserve(file, { limits: { ...LIMITS, invocation: 0 } }), "REFUSED");
    assertRefused(file, before, reserve(file, { lease: { ...LEASE, active: false } }), "IDENTITY_GAP");
    assertRefused(file, before, reserve(file, { lease: { ...LEASE, generation: 2 } }), "IDENTITY_GAP");
    assert.equal(reserve(file).outcome, "PASS");
    const active = bytes(file);
    assertRefused(file, active, dr().transition(file, { type: "admit", key: { ...KEY, generation: 0 }, kind: "review" }), "IDENTITY_GAP");
    assert.equal(apply(file, { type: "admit", kind: "review" }).outcome, "PASS");
  });

  it("keeps an in-flight attempt open until it receives an identified completion", (t) => {
    const file = journey(t);
    const attempt_id = dispatched(file);
    const event = { type: "receipt", attempt_id, candidate_revision: REV };
    assertRefused(file, bytes(file), apply(file, event), "HOLD");
    assert.equal(dr().read(file, KEY).state, "DISPATCHED");
    assert.equal(apply(file, { ...event, event_id: "completion" }).state, "COMPLETED");
  });

  it("recovery keeps spent 1/1/1 and limits 2/1/1; a second repair at the same boundary is refused", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    assert.equal(apply(file, { type: "admit", kind: "review" }).outcome, "PASS");
    assert.equal(apply(file, { type: "admit", kind: "repair" }).outcome, "PASS");
    assert.deepEqual(dr().read(file, KEY).spent, { invocation: 1, review: 1, repair: 1 });
    apply(file, { type: "disconnect", attempt_id: id });
    assert.equal(check(file, id).state, "RECOVERABLE");
    // A successor that asks for larger limits must not expand them.
    const next = reserve(file, { limits: { invocation: 9, review: 9, repair: 9 } });
    assert.equal(next.outcome, "PASS");
    assert.equal(next.attempt.attempt, 2);
    const view = dr().read(file, KEY);
    assert.deepEqual(view.spent, { invocation: 1, review: 1, repair: 1 });
    assert.deepEqual(view.limits, { invocation: 2, review: 1, repair: 1 });
    const before = bytes(file);
    const extra = apply(file, { type: "admit", kind: "repair" });
    assertRefused(file, before, extra, "REFUSED");
    assert.match(extra.reason, /repair/);
    assert.deepEqual(dr().read(file, KEY).spent, { invocation: 1, review: 1, repair: 1 });
  });
});

describe("SM03 illegal transitions (SEIT-SM03-X)", () => {
  it("SM03.X1 duplicate dispatch from RESERVED|DISPATCHED|HELD reuses the open attempt or holds; no second launch", (t) => {
    for (const setup of [reserved, dispatched, held]) {
      const file = journey(t);
      const id = setup(file);
      const state = dr().read(file, KEY).state;
      const before = bytes(file);
      const r = reserve(file);
      assertRefused(file, before, r);
      if (r.attempt) assert.equal(r.attempt.attempt_id, id, "reuses the open attempt");
      const view = dr().read(file, KEY);
      assert.equal(view.state, state);
      assert.equal(view.attempts.length, 1, setup.name);
    }
  });

  it("SM03.X2 UNKNOWN/RUNNING with owner resume never permits recovery from CHECKING|HELD", (t) => {
    for (const setup of [checking, held]) {
      for (const liveness of ["UNKNOWN", "RUNNING"]) {
        const file = journey(t);
        const id = setup(file);
        const r = check(file, id, { liveness, owner_resume: true });
        assert.notEqual(r.state, "RECOVERABLE", `${setup.name}/${liveness}`);
        const before = bytes(file);
        assertRefused(file, before, reserve(file));
        assert.equal(dr().read(file, KEY).attempts.length, 1);
      }
    }
  });

  it("SM03.X3 RECOVERABLE route change without a recorded verified-unavailability condition does not dispatch", (t) => {
    const file = journey(t);
    recoverable(file);
    for (const route of ["fallback:1", "fallback:2"]) {
      const before = bytes(file);
      assertRefused(file, before, reserve(file, { route }));
    }
    assert.equal(dr().read(file, KEY).state, "RECOVERABLE");
  });

  it("SM03.X4 COMPLETED: replayed completion is an idempotent no-op and never redispatches", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    const receipt = { type: "receipt", attempt_id: id, event_id: "ev-1", candidate_revision: REV };
    assert.equal(apply(file, receipt).state, "COMPLETED");
    const before = bytes(file);
    const replay = apply(file, receipt);
    assertRefused(file, before, replay, "NO_OP");
    assert.equal(replay.state, "COMPLETED");
    assertRefused(file, before, reserve(file));
    assert.equal(dr().read(file, KEY).attempts.length, 1);
  });

  it("SM03.X5 candidate, branch, generation or lease mismatch: no transition, named identity gap", (t) => {
    const cases = [
      [checking, (f, id) => check(f, id, { lease: { ...LEASE, generation: 2 } }), /generation|lease/],
      [checking, (f, id) => check(f, id, { lease: { ...LEASE, branch: "other" } }), /branch|lease/],
      [dispatched, (f, id) => apply(f, { type: "receipt", attempt_id: id, event_id: "ev-1", candidate_revision: "rev-b" }), /candidate/],
    ];
    for (const [setup, act, reason] of cases) {
      const file = journey(t);
      const id = setup(file);
      const state = dr().read(file, KEY).state;
      const before = bytes(file);
      const r = act(file, id);
      assertRefused(file, before, r, "IDENTITY_GAP");
      assert.match(r.reason, reason);
      assert.equal(dr().read(file, KEY).state, state);
    }
  });

  it("SM03.X6 a new generation cannot bypass an active or unknown prior writer", (t) => {
    for (const setup of [dispatched, held]) {
      const file = journey(t);
      setup(file);
      const before = bytes(file);
      const r = dr().transition(file, { type: "reserve", key: { ...KEY, generation: 2 }, candidate_revision: REV, route: "primary",
        routes: ["primary", "fallback:1"], launch_digest: "e".repeat(64), lease: { generation: 2, branch: "slice/s1" }, limits: LIMITS, authorized: true });
      assertRefused(file, before, r);
    }
  });

  it("SM03.X6 a new generation does not reset spent allowances or expand limits", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    apply(file, { type: "admit", kind: "repair" });
    apply(file, { type: "disconnect", attempt_id: id });
    assert.equal(check(file, id).state, "RECOVERABLE");
    const gen2 = { ...KEY, generation: 2 };
    const r = dr().transition(file, { type: "reserve", key: gen2, candidate_revision: REV, route: "primary",
      routes: ["primary", "fallback:1"], launch_digest: "e".repeat(64), lease: { generation: 2, branch: "slice/s1" },
      limits: { invocation: 9, review: 9, repair: 9 }, authorized: true });
    assert.equal(r.outcome, "PASS", JSON.stringify(r));
    const view = dr().read(file, gen2);
    assert.deepEqual(view.spent, { invocation: 1, review: 0, repair: 1 });
    assert.deepEqual(view.limits, LIMITS);
    const before = bytes(file);
    assertRefused(file, before, dr().transition(file, { type: "admit", key: gen2, kind: "repair" }), "REFUSED");
  });
});

// Child process body for the concurrent-reservation probe: waits for a shared start instant.
const CHILD = `
const dr = require(process.argv[1]);
const start = Number(process.argv[3]);
while (Date.now() < start) {}
const r = dr.transition(process.argv[2], JSON.parse(process.argv[4]));
process.stdout.write(JSON.stringify(r));
`;
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CHILD, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}: ${err.slice(-2000)}`))));
  });
}

describe("TB06 host session identity into assignment ownership (SEIT-TB06-N)", () => {
  it("two concurrent cross-process reservations resolve to one attempt", async (t) => {
    const file = journey(t);
    dr(); // fail by name here, before spawning, while the module is missing
    const event = JSON.stringify({ type: "reserve", key: KEY, candidate_revision: REV, route: "primary", routes: ["primary"],
      launch_digest: "d".repeat(64), lease: { generation: 1, branch: "slice/s1" }, limits: LIMITS, authorized: true });
    const start = String(Date.now() + 400);
    const results = await Promise.all([run([MODULE, file, start, event]), run([MODULE, file, start, event])]);
    assert.equal(results.filter((r) => r.outcome === "PASS").length, 1, JSON.stringify(results));
    const view = dr().read(file, KEY);
    assert.equal(view.attempts.length, 1);
    assert.equal(view.state, "RESERVED");
    assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
  });

  it("stale completion from a closed attempt is rejected, leaks no canary, and independent ready work proceeds", (t) => {
    const file = journey(t);
    const old = recoverable(file);
    const next = reserve(file);
    apply(file, { type: "attach", attempt_id: next.attempt.attempt_id, host_session_id: "sess-2" });
    const canary = "CANARY-tb06-7f3c";
    const before = bytes(file);
    const r = apply(file, { type: "receipt", attempt_id: old, event_id: "ev-old", candidate_revision: REV, note: canary });
    assertRefused(file, before, r);
    assert.equal(dr().read(file, KEY).state, "DISPATCHED", "stale receipt does not advance the current attempt");
    assert.ok(!JSON.stringify(r).includes(canary), "no canary in output");
    assert.ok(!readFileSync(file, "utf8").includes(canary), "no canary in owned record");
    const out = ready().evaluate({
      slices: [
        { id: "S1", depends_on: [], write_set: ["hooks/a.cjs"] },
        { id: "S2", depends_on: [], write_set: ["hooks/b.cjs"] },
      ],
      assignments: { S1: dr().read(file, KEY).state },
    });
    assert.deepEqual(out.ready, ["S2"]);
  });

  it("an unbound reservation after interruption holds and blocks a second launch", (t) => {
    const file = journey(t);
    const id = reserved(file);
    assert.equal(apply(file, { type: "interrupted", attempt_id: id }).state, "HELD");
    const r = check(file, id); // even exited-looking evidence cannot bind an unbound attempt
    assert.notEqual(r.state, "RECOVERABLE");
    assert.equal(dr().read(file, KEY).attempts.length, 1);
  });
});

describe("F07 dispatch record flow (SEIT-F07)", () => {
  it("positive path: reserve -> attach -> receipt retains identity evidence and completes once", (t) => {
    const file = journey(t);
    const id = dispatched(file);
    const r = apply(file, { type: "receipt", attempt_id: id, event_id: "ev-1", candidate_revision: REV });
    assert.equal(r.state, "COMPLETED");
    const [a] = dr().read(file, KEY).attempts;
    assert.equal(a.attempt, 1);
    assert.equal(a.host_session_id, "sess-1");
    assert.equal(a.candidate_revision, REV);
    assert.equal(a.route, "primary");
    assert.equal(a.launch_digest, "d".repeat(64));
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).unrelated, { keep: "me" });
  });

  it("lock held by another writer: records preserved, gap reported, no steal", (t) => {
    const file = journey(t);
    const before = bytes(file);
    mkdirSync(file + ".lock");
    t.after(() => rmSync(file + ".lock", { recursive: true, force: true }));
    const r = reserve(file);
    assert.notEqual(r.outcome, "PASS");
    assert.match(r.reason, /lock/);
    assert.deepEqual(bytes(file), before);
    assert.equal(existsSync(file + ".lock"), true, "foreign lock not stolen");
  });
});

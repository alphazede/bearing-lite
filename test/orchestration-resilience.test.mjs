// S14T (Bearing 3.0, W3): orchestration resilience integration suite (N14).
// Oracle: B30-510 scenario list; SEIT-B30-510 (ten subtests), SEIT-B30-501,
// SEIT-B30-502, SEIT-B30-504, SEIT-B30-505; SM02/SM03/SM04 transitions; DEC-08,
// DEC-09, DEC-16.
//
// One subtest per B30-510 scenario, each on a fresh three-slice journey
// (S1 and S2 independent, S3 depends on both) in its own mkdtemp root.
// Public entry points driven together:
//   hooks/ready-set.cjs        evaluate({ slices, assignments, ... }) -> { ready, excluded }
//   hooks/dispatch-record.cjs  transition(journeyFile, event), read(journeyFile, key)
//   hooks/profiles.cjs         evaluateCatalogState({ env }), freezeSelectedRoutes({ profile })
//   hooks/protected-action.cjs evaluate(input) -> { outcome, reason, ... }
//   hooks/assurance-budget.cjs evaluateAssuranceBudget(request) -> { outcome, reason }
// The decision engine is advisory (DEC-13, B30-510 "no decision-engine stop gap"):
// the decision scenarios record a failed, timed-out or absent decision in the shared
// journey record and prove the lifecycle hooks still drive the journey to completion
// on the rules-only path and keep that record intact. Adapter-level timeout and
// fallback mechanics (N07) are proven by the decision-adapter suites.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const DISPATCH = path.join(ROOT, "hooks/dispatch-record.cjs");
const READY = path.join(ROOT, "hooks/ready-set.cjs");
const dr = () => require(DISPATCH);
const rs = () => require(READY);
const profiles = () => require(path.join(ROOT, "hooks/profiles.cjs"));
const protectedAction = () => require(path.join(ROOT, "hooks/protected-action.cjs"));
const budget = () => require(path.join(ROOT, "hooks/assurance-budget.cjs"));

const SLICES = Object.freeze([
  { id: "S1", depends_on: [], write_set: ["hooks/a.cjs"] },
  { id: "S2", depends_on: [], write_set: ["hooks/b.cjs"] },
  { id: "S3", depends_on: ["S1", "S2"], write_set: ["hooks/c.cjs"] },
]);
const LIMITS = Object.freeze({ invocation: 2, review: 1, repair: 1 });
const REV = "rev-a";
const key = (slice, role = "implementer") => ({ journey: "J1", wave: "W3", slice, role, generation: 1 });

function journey(t, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "orchestration-resilience-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "journey.json");
  writeFileSync(file, JSON.stringify({ schema_version: 1, journey: "J1", ...extra }, null, 2) + "\n");
  return file;
}
const apply = (file, slice, event, role) => dr().transition(file, { key: key(slice, role), ...event });
function reserve(file, slice, over = {}, role) {
  return apply(file, slice, {
    type: "reserve", candidate_revision: REV, route: "primary", routes: ["primary", "fallback:1"],
    launch_digest: "d".repeat(64), lease: { generation: 1, branch: `slice/${slice}` }, limits: LIMITS, authorized: true, ...over,
  }, role);
}
function pass(result) {
  assert.equal(result.outcome, "PASS", JSON.stringify(result));
  return result;
}
function dispatch(file, slice, role) {
  const id = pass(reserve(file, slice, {}, role)).attempt.attempt_id;
  pass(apply(file, slice, { type: "attach", attempt_id: id, host_session_id: `sess-${slice}` }, role));
  return id;
}
const finish = (file, slice, id, role) =>
  pass(apply(file, slice, { type: "receipt", attempt_id: id, event_id: `ev-${slice}-${id}`, candidate_revision: REV }, role));
const states = (file) => Object.fromEntries(SLICES.map((s) => [s.id, dr().read(file, key(s.id)).state]));
const ready = (file, slices = SLICES) => rs().evaluate({ slices, assignments: states(file) });

// Drives the whole journey on the rules-only path: dispatch every ready slice, finish it, repeat.
function runJourney(file) {
  const order = [];
  for (let round = 0; round < SLICES.length; round += 1) {
    const { ready: now } = ready(file);
    if (!now.length) break;
    const ids = now.map((slice) => [slice, dispatch(file, slice)]);
    for (const [slice, id] of ids) finish(file, slice, id);
    order.push(now);
  }
  return order;
}
const COMPLETE = { S1: "COMPLETED", S2: "COMPLETED", S3: "COMPLETED" };

describe("B30-510 orchestration resilience (SEIT-B30-510)", () => {
  it("1. parallel slices: independent slices dispatch together; dependents and overlapping writes wait", (t) => {
    const file = journey(t);
    const overlap = { id: "S4", depends_on: [], write_set: ["hooks/a.cjs"] };
    assert.deepEqual(ready(file).ready, ["S1", "S2"]);
    const a = dispatch(file, "S1");
    const b = dispatch(file, "S2");
    const during = ready(file, [...SLICES, overlap]);
    assert.deepEqual(during.ready, []);
    assert.deepEqual(during.excluded.find((row) => row.slice === "S3"), { slice: "S3", cause: "dependency", by: "S1" });
    assert.deepEqual(during.excluded.find((row) => row.slice === "S4"), { slice: "S4", cause: "write overlap", by: "S1" });
    finish(file, "S1", a);
    finish(file, "S2", b);
    assert.deepEqual(ready(file).ready, ["S3"]);
    finish(file, "S3", dispatch(file, "S3"));
    assert.deepEqual(states(file), COMPLETE);
  });

  it("2. decision failure: the scheduler continues independent work and preserves the caller's failure record", (t) => {
    const decisions = [{ type: "dispatch_classification", outcome: "error", detail: "driver returned 500" }];
    const file = journey(t, { decisions });
    const pending = [{ slice: "S1" }];
    const waiting = rs().evaluate({ slices: SLICES, assignments: states(file), pending });
    assert.deepEqual(waiting.ready, ["S2"]);
    assert.deepEqual(waiting.excluded.find((row) => row.slice === "S1"), { slice: "S1", cause: "pending" });
    finish(file, "S2", dispatch(file, "S2"));
    assert.deepEqual(runJourney(file), [["S1"], ["S3"]]);
    assert.deepEqual(states(file), COMPLETE);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).decisions, decisions, "decision record preserved");
  });

  it("3. decision timeout fallback: once the caller clears a pending decision, readiness matches the rules-only path", (t) => {
    const decisions = [{ type: "dispatch_classification", outcome: "timeout", fallback: "rules" }];
    const file = journey(t, { decisions });
    const held = rs().evaluate({ slices: SLICES, assignments: states(file), pending: [{ slice: "S1" }] });
    assert.deepEqual(held.ready, ["S2"]);
    assert.deepEqual(ready(file), ready(journey(t)));
    assert.deepEqual(runJourney(file), [["S1", "S2"], ["S3"]], "same order as the rules-only path");
    assert.deepEqual(states(file), COMPLETE);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).decisions, decisions);
  });

  it("4. interrupted journey resume: recovery reuses the logical assignment, stale work is refused, dependents release", (t) => {
    const file = journey(t);
    const first = dispatch(file, "S1");
    const s2 = dispatch(file, "S2");
    finish(file, "S2", s2);
    pass(apply(file, "S1", { type: "disconnect", attempt_id: first }));
    const lease = { generation: 1, branch: "slice/S1", active: true };
    const probe = { type: "check", attempt_id: first, receipt: null, lease, candidate_revision: REV };
    // A live session after reconnect is the same attempt, not a new dispatch.
    assert.equal(pass(apply(file, "S1", { ...probe, liveness: "RUNNING", exclusive_ownership: true })).state, "DISPATCHED");
    pass(apply(file, "S1", { type: "disconnect", attempt_id: first }));
    assert.deepEqual(ready(file).excluded.find((row) => row.slice === "S1"), { slice: "S1", cause: "in-flight" });
    assert.equal(pass(apply(file, "S1", { ...probe, liveness: "EXITED", exclusive_ownership: true })).state, "RECOVERABLE");
    assert.deepEqual(ready(file).ready, ["S1"], "a recoverable slice is ready again");
    const second = pass(reserve(file, "S1"));
    assert.equal(second.attempt.attempt, 2);
    pass(apply(file, "S1", { type: "attach", attempt_id: second.attempt.attempt_id, host_session_id: "sess-S1b" }));
    const stale = apply(file, "S1", { type: "receipt", attempt_id: first, event_id: "ev-stale", candidate_revision: REV });
    assert.equal(stale.outcome, "HOLD", JSON.stringify(stale));
    finish(file, "S1", second.attempt.attempt_id);
    assert.equal(dr().read(file, key("S1")).attempts.length, 2, "one logical assignment, two attempts, no duplicate");
    assert.deepEqual(ready(file).ready, ["S3"]);
  });

  it("5. profile migration: legacy catalogs need migration; dispatch keeps the frozen route and evidenced fallback", (t) => {
    const file = journey(t);
    const home = path.join(path.dirname(file), "home");
    mkdirSync(path.join(home, ".agents", "bearing-lite"), { recursive: true });
    writeFileSync(path.join(home, ".agents", "bearing-lite", "lineups.json"), "{}\n");
    assert.equal(profiles().evaluateCatalogState({ env: { HOME: home } }).outcome, "MIGRATION_REQUIRED");

    const live = { roles: { implementer: { harness: "H1", model: "m1", effort: "high" } } };
    const frozen = profiles().freezeSelectedRoutes({ profile: live });
    live.roles.implementer.model = "m2"; // live catalog edited after freeze
    assert.equal(frozen.snapshot.roles.implementer.model, "m1", "frozen snapshot unchanged by the live edit");
    assert.notEqual(profiles().freezeSelectedRoutes({ profile: live }).digest, frozen.digest);

    const id = pass(reserve(file, "S1")).attempt.attempt_id;
    const proof = { no_session: true, no_process: true };
    pass(apply(file, "S1", { type: "launch_failed", attempt_id: id, proof }));
    assert.equal(reserve(file, "S1", { route: "fallback:1" }).outcome, "HOLD", "fallback without verified-unavailability evidence refused");
    const retry = pass(reserve(file, "S1")).attempt.attempt_id;
    pass(apply(file, "S1", { type: "launch_failed", attempt_id: retry, proof, unavailable_condition: "quota" }));
    const fallback = pass(reserve(file, "S1", { route: "fallback:1" }));
    assert.equal(dr().read(file, key("S1")).attempts[fallback.attempt.attempt - 1].route, "fallback:1");
  });

  it("6. protected authority hold: owner-only actions wait for recorded authority while independent work proceeds", (t) => {
    const file = journey(t);
    const pa = protectedAction();
    for (const action of ["public_export_push", "release_publication", "catalog_write"]) {
      assert.equal(pa.evaluate({ protected_action: action, owner_only: true }).outcome, "REROUTE", `${action} held without authority`);
      assert.equal(pa.evaluate({ protected_action: action, owner_only: true, owner_authorized: true }).outcome, "ADVISE", `${action} allowed with authority`);
      assert.equal(pa.evaluate({ protected_action: action, destructive_public_without_authority: true }).outcome, "BLOCK");
      assert.equal(pa.evaluate({ protected_action: action, owner_only: true, infrastructure_failure: "store down" }).outcome, "UNAVAILABLE",
        "infrastructure failure is never implicit permission");
    }
    assert.equal(pa.evaluate({ protected_action: "release_publication", channel: "status" }).outcome, "ADVISE", "status channel stays open");
    // S1 waits on the owner (held); S2 is unaffected.
    const held = pass(reserve(file, "S1")).attempt.attempt_id;
    assert.equal(pass(apply(file, "S1", { type: "interrupted", attempt_id: held })).state, "HELD");
    const now = ready(file);
    assert.deepEqual(now.ready, ["S2"]);
    assert.deepEqual(now.excluded.find((row) => row.slice === "S1"), { slice: "S1", cause: "held" });
  });

  it("7. independent assurance: an author result never completes or waives the assurance assignment", (t) => {
    const file = journey(t);
    runJourney(file);
    const ASSURANCE = "test_engineer.assurance";
    const before = readFileSync(file);
    const authorAsAssurance = apply(file, "S3", { type: "receipt", attempt_id: "author-attempt", event_id: "ev-author", candidate_revision: REV }, ASSURANCE);
    assert.equal(authorAsAssurance.outcome, "HOLD", JSON.stringify(authorAsAssurance));
    assert.deepEqual(readFileSync(file), before, "refused author result writes nothing");
    const view = dr().read(file, key("S3", ASSURANCE));
    assert.equal(view.state, "READY");
    assert.deepEqual(view.attempts, []);
    const own = pass(reserve(file, "S3", {}, ASSURANCE));
    assert.equal(own.attempt.attempt, 1, "assurance runs as its own attempt on the exact candidate");
    assert.equal(dr().read(file, key("S3")).state, "COMPLETED", "author assignment unchanged");
  });

  it("8. no duplicate dispatch: two concurrent dispatchers on one ready set record one attempt", async (t) => {
    const file = journey(t);
    const snapshot = ready(file).ready;
    assert.deepEqual(snapshot, ["S1", "S2"]);
    const results = await Promise.all([runChild(file, snapshot), runChild(file, snapshot)]);
    for (const slice of snapshot) {
      assert.deepEqual(results.map((result) => result[slice]?.outcome).sort(), ["HOLD", "PASS"], JSON.stringify(results));
      assert.equal(dr().read(file, key(slice)).attempts.length, 1);
    }
    assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
  });

  it("9. bounded escalation: one review round and one repair per boundary; no automatic re-review", (t) => {
    const file = journey(t);
    dispatch(file, "S1");
    const admit = (kind) => apply(file, "S1", { type: "admit", kind });
    pass(admit("review"));
    const before = readFileSync(file);
    assert.equal(admit("review").outcome, "REFUSED", "second review round not admitted");
    assert.deepEqual(readFileSync(file), before);
    pass(admit("repair"));
    assert.equal(admit("repair").outcome, "REFUSED", "second repair not admitted");
    assert.deepEqual(dr().read(file, key("S1")).spent, { invocation: 1, review: 1, repair: 1 });
    for (const request of [{ review_after_repair: true }, { automatic_rereview_requested: true }]) {
      assert.equal(budget().evaluateAssuranceBudget({ journey: "J1", unit_kind: "wave", ...request }).outcome, "OWNER_AMENDMENT_REQUIRED",
        "repair closes by deterministic verification, never an automatic review");
    }
  });

  it("10. no decision-engine stop gap: with no decision engine for the whole run the journey completes", (t) => {
    const file = journey(t);
    assert.deepEqual(runJourney(file), [["S1", "S2"], ["S3"]]);
    assert.deepEqual(states(file), COMPLETE);
    assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
  });
});

// Both dispatchers reserve from the same snapshot, even when one process starts later.
const CHILD = `
const [dispatchPath, file, readyJson] = process.argv.slice(1);
const dr = require(dispatchPath);
const key = (slice) => ({ journey: "J1", wave: "W3", slice, role: "implementer", generation: 1 });
const out = {};
for (const slice of JSON.parse(readyJson)) {
  out[slice] = dr.transition(file, { type: "reserve", key: key(slice), candidate_revision: "${REV}", route: "primary",
    routes: ["primary"], launch_digest: "d".repeat(64), lease: { generation: 1, branch: "slice/" + slice },
    limits: { invocation: 2, review: 1, repair: 1 }, authorized: true });
}
process.stdout.write(JSON.stringify(out));
`;
function runChild(file, snapshot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CHILD, DISPATCH, file, JSON.stringify(snapshot)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}: ${err.slice(-2000)}`))));
  });
}

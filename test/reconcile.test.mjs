import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { applyEvent, replay } = require(path.join(ROOT, "hooks/reconcile.cjs"));
const SHA = "a".repeat(64);
const initial = () => ({ journey: "j-1", repository: "alphazede/bearing-lite", generation: 2, version: 0, applied_event_ids: [], slices: {} });
const event = (kind, id = kind, overrides = {}) => ({
  schema_version: 1,
  event_id: id,
  source: "test",
  journey: "j-1",
  repository: "alphazede/bearing-lite",
  unit: { wave: "wave-1", slice: "slice-1" },
  candidate_revision: "candidate-a",
  generation: 2,
  evidence: { ref: `evidence/${id}`, sha256: SHA },
  transition: { kind, verdict: "PASS" },
  occurred_at: "2026-09-11T12:00:00Z",
  ...overrides,
});
const lifecycle = () => ["implementation", "verification", "assurance", "acceptance"].map((kind) => event(kind));

describe("reconcile evidence events (#64)", () => {
  it("applies the normal lifecycle without mutating inputs", () => {
    const start = initial();
    const log = lifecycle();
    const before = structuredClone(log);
    const result = replay(start, log);
    assert.deepEqual(log, before);
    assert.deepEqual(start, initial());
    assert.equal(result.state.version, 4);
    assert.deepEqual(Object.keys(result.state.slices["slice-1"]), ["implementation", "verification", "assurance", "acceptance"]);
    assert.ok(result.receipts.every((receipt) => receipt.applied));
  });

  it("rejects a duplicate event", () => {
    const first = applyEvent(initial(), event("implementation"));
    const second = applyEvent(first.state, event("implementation"));
    assert.equal(second.receipt.code, "duplicate_event");
    assert.strictEqual(second.state, first.state);
  });

  it("accepts an out-of-order event when the same log is replayed after its predecessor arrives", () => {
    const log = [event("verification"), event("implementation")];
    const first = replay(initial(), log);
    assert.deepEqual(first.receipts.map((r) => r.code), ["predecessor_missing", "applied"]);
    const second = replay(first.state, log);
    assert.deepEqual(second.receipts.map((r) => r.code), ["applied", "duplicate_event"]);
    assert.equal(second.state.slices["slice-1"].verification.verdict, "PASS");
  });

  it("rejects stale generations", () => {
    assert.equal(applyEvent(initial(), event("implementation", "old", { generation: 1 })).receipt.code, "stale_generation");
  });

  it("rejects stale candidates", () => {
    const state = applyEvent(initial(), event("implementation")).state;
    assert.equal(applyEvent(state, event("verification", "wrong", { candidate_revision: "candidate-b" })).receipt.code, "stale_candidate");
  });

  it("escalates conflicting receipts without overwriting", () => {
    const first = applyEvent(initial(), event("implementation"));
    const conflict = event("implementation", "conflict", { transition: { kind: "implementation", verdict: "FAIL" } });
    const second = applyEvent(first.state, conflict);
    assert.equal(second.receipt.code, "conflicting_receipt");
    assert.strictEqual(second.state, first.state);
  });

  it("rejects a delayed conflicting receipt without overwriting the current candidate", () => {
    const result = replay(initial(), [
      event("implementation", "a-pass", { candidate_revision: "A" }),
      event("implementation", "b-pass", { candidate_revision: "B" }),
      event("implementation", "a-fail", { candidate_revision: "A", transition: { kind: "implementation", verdict: "FAIL" } }),
    ]);
    assert.deepEqual(result.receipts.map((receipt) => receipt.code), ["applied", "applied", "conflicting_receipt"]);
    assert.equal(result.state.slices["slice-1"].implementation.candidate_revision, "B");
  });

  it("rejects an identical receipt for a candidate the slice has moved past", () => {
    const result = replay(initial(), [
      event("implementation", "a-pass", { candidate_revision: "A" }),
      event("implementation", "b-pass", { candidate_revision: "B" }),
      event("implementation", "a-pass-again", { candidate_revision: "A" }),
    ]);
    assert.deepEqual(result.receipts.map((receipt) => receipt.code), ["applied", "applied", "stale_candidate"]);
    assert.equal(result.state.slices["slice-1"].implementation.candidate_revision, "B");
    assert.deepEqual(result.state.slices["slice-1"].implementation.history, {
      A: { verdict: "PASS", sha256: SHA },
      B: { verdict: "PASS", sha256: SHA },
    });
  });

  it("rejects PASS without evidence and other missing evidence", () => {
    const bare = event("implementation", "bare", { evidence: {} });
    const missing = event("implementation", "missing", { evidence: {}, transition: { kind: "implementation", verdict: "FAIL" } });
    assert.equal(applyEvent(initial(), bare).receipt.code, "bare_pass");
    assert.equal(applyEvent(initial(), missing).receipt.code, "missing_evidence");
  });

  it("rejects an unrelated repository", () => {
    assert.equal(applyEvent(initial(), event("implementation", "other", { repository: "other/repo" })).receipt.code, "unrelated_journey");
  });

  it("rejects stale optimistic writes", () => {
    assert.equal(applyEvent(initial(), event("implementation"), { expected_version: 1 }).receipt.code, "stale_write");
  });

  it("rejects structurally invalid events", () => {
    assert.equal(applyEvent(initial(), event("implementation", "invalid", { occurred_at: "2026-09-11" })).receipt.code, "invalid_event");
  });

  it("records merge as an observation without granting acceptance", () => {
    const result = applyEvent(initial(), event("merge"));
    assert.equal(result.state.slices["slice-1"].observed_merge.verdict, "PASS");
    assert.equal(result.state.slices["slice-1"].acceptance, undefined);
  });

  it("raises generation only for accepted events", () => {
    const accepted = applyEvent(initial(), event("implementation", "new", { generation: 3 }));
    const rejected = applyEvent(initial(), event("verification", "rejected-new", { generation: 3 }));
    assert.equal(accepted.state.generation, 3);
    assert.equal(rejected.state.generation, 2);
  });

  it("is idempotent when an applied log is replayed", () => {
    const first = replay(initial(), lifecycle());
    const second = replay(first.state, lifecycle());
    assert.deepEqual(second.state, first.state);
    assert.ok(second.receipts.every((receipt) => receipt.code === "duplicate_event"));
  });

  it("round trips state and NDJSON through the CLI", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reconcile-"));
    try {
      const stateFile = path.join(dir, "state.json");
      const eventsFile = path.join(dir, "events.ndjson");
      writeFileSync(stateFile, JSON.stringify(initial()));
      writeFileSync(eventsFile, lifecycle().map(JSON.stringify).join("\n") + "\n");
      const run = spawnSync(process.execPath, [path.join(ROOT, "hooks/reconcile.cjs"), stateFile, eventsFile], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).version, 4);
      assert.equal(run.stdout.trim().split("\n").map(JSON.parse).length, 4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

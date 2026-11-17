// S07T (Bearing 3.0, W2): ready-set evaluator over the frozen graph (N06, DES-F08).
// Oracle: boundary contract F08 data_contract.concurrency ("hold assignment and
// named dependents/write overlaps/resources only; disjoint ready slices continue;
// no machine-global serialization"), SM03 ("UNKNOWN => HELD, only
// assignment/dependents held"), TB06 negative check; SEIT-B30-116,
// SEIT-B30-211, SEIT-F08.
//
// Public entry point this file binds (hooks/ready-set.cjs):
//   evaluate({ slices, assignments?, pending?, busy_resources? })
//     -> { ready: [sliceId] (graph order), excluded: [{ slice, cause, by? }] }
//   slices: waveView slice shape { id, depends_on, write_set, resource_groups? }
//   assignments: { [sliceId]: SM03 state } (absent = not yet dispatched)
//   pending: [{ slice, kind: "decision" | "consultation" }]
//   busy_resources: [resource group name]
// cause names (matched by pattern): held, in_flight, completed, dependency,
// missing dependency, write overlap, resource, pending. `by` names the slice or
// resource that causes the exclusion. Pure: inputs are not mutated.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// Loaded per test so a missing module fails each case by name (expected-red baseline).
const rs = () => require(path.join(ROOT, "hooks/ready-set.cjs"));
const dr = () => require(path.join(ROOT, "hooks/dispatch-record.cjs"));
const { waveView } = require(path.join(ROOT, "hooks/plan-package.cjs"));

const slice = (id, depends_on = [], write_set = [`src/${id}.js`], extra = {}) => ({ id, depends_on, write_set, ...extra });
const exclusion = (out, id) => out.excluded.find((e) => e.slice === id);
function assertExcluded(out, id, cause, by) {
  const e = exclusion(out, id);
  assert.ok(e, `${id} excluded: ${JSON.stringify(out)}`);
  assert.ok(!out.ready.includes(id), `${id} not ready`);
  assert.match(e.cause, cause);
  if (by) assert.equal(e.by, by);
}
function tempDir(t, prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("held assignment holds only itself and its dependents (SEIT-B30-116)", () => {
  it("S1 UNKNOWN liveness: S1 replacement held, dependent S3 held, independent S2 ready", (t) => {
    const file = path.join(tempDir(t, "wave-fixtures-"), "journey.json");
    writeFileSync(file, JSON.stringify({ schema_version: 1, journey: "J1" }) + "\n");
    const key = { journey: "J1", wave: "W2", slice: "S1", role: "implementer", generation: 1 };
    const lease = { generation: 1, branch: "slice/s1" };
    const reserve = () => dr().transition(file, { type: "reserve", key, candidate_revision: "rev-a", route: "primary",
      routes: ["primary"], launch_digest: "d".repeat(64), lease, limits: { invocation: 2, review: 1, repair: 1 }, authorized: true });
    const id = reserve().attempt.attempt_id;
    dr().transition(file, { type: "attach", key, attempt_id: id, host_session_id: "sess-1" });
    dr().transition(file, { type: "disconnect", key, attempt_id: id });
    const decision = dr().transition(file, { type: "check", key, attempt_id: id, liveness: "UNKNOWN", exclusive_ownership: false,
      receipt: null, lease: { ...lease, active: true }, candidate_revision: "rev-a" });
    assert.equal(decision.state, "HELD");
    assert.notEqual(reserve().outcome, "PASS", "replacement for S1 not permitted");
    const out = rs().evaluate({
      slices: [slice("S1"), slice("S2"), slice("S3", ["S1"])],
      assignments: { S1: dr().read(file, key).state },
    });
    assert.deepEqual(out.ready, ["S2"]);
    assertExcluded(out, "S1", /held/i);
    assertExcluded(out, "S3", /depend/i, "S1");
  });
});

describe("pending decision or consultation holds nothing else (SEIT-B30-211)", () => {
  it("S2 ready while S1 decision and S3 consultation are pending; neither is double-dispatched", () => {
    const input = {
      slices: [slice("S1"), slice("S2"), slice("S3")],
      assignments: {},
      pending: [{ slice: "S1", kind: "decision" }, { slice: "S3", kind: "consultation" }],
    };
    const out = rs().evaluate(input);
    assert.deepEqual(out.ready, ["S2"]);
    assertExcluded(out, "S1", /pending/i);
    assertExcluded(out, "S3", /pending/i);
    assert.deepEqual(rs().evaluate(input), out, "re-evaluation while pending is stable");
  });

  it("an in-flight slice awaiting a decision is not offered again", () => {
    const out = rs().evaluate({
      slices: [slice("S1"), slice("S2")],
      assignments: { S1: "DISPATCHED" },
      pending: [{ slice: "S1", kind: "decision" }],
    });
    assert.deepEqual(out.ready, ["S2"]);
    assert.ok(exclusion(out, "S1"));
  });
});

describe("F08 ready-set flow over the frozen graph (SEIT-F08)", () => {
  it("positive: waveView slices from a frozen package feed completion-driven readiness", (t) => {
    const dir = tempDir(t, "wave-fixtures-");
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({
      waves: [{ id: "W1", slice_ids: ["A", "B", "C", "D"] }],
      slices: [
        { id: "A", write_set: ["repo: src/a.js"], command_ids: [] },
        { id: "B", depends_on: ["A"], write_set: ["repo: src/b.js"], command_ids: [] },
        { id: "C", depends_on: ["A", "B"], write_set: ["repo: src/c.js"], command_ids: [] },
        { id: "D", write_set: ["repo: src/d.js"], command_ids: [] },
      ],
    }));
    writeFileSync(path.join(dir, "seit.json"), JSON.stringify({ procedures_and_commands: [] }));
    const view = waveView(dir, "W1");
    assert.equal(view.outcome, "PASS", JSON.stringify(view.findings));
    let out = rs().evaluate({ slices: view.slices, assignments: {} });
    assert.deepEqual(out.ready, ["A", "D"]);
    assertExcluded(out, "B", /depend/i, "A");
    out = rs().evaluate({ slices: view.slices, assignments: { A: "COMPLETED", D: "DISPATCHED" } });
    assert.deepEqual(out.ready, ["B"]);
    assertExcluded(out, "A", /complet/i);
    assertExcluded(out, "D", /in.?flight/i);
    assertExcluded(out, "C", /depend/i, "B");
    out = rs().evaluate({ slices: view.slices, assignments: { A: "COMPLETED", B: "COMPLETED", D: "COMPLETED" } });
    assert.deepEqual(out.ready, ["C"]);
  });

  it("negative: a dependency missing from the frozen graph excludes only its dependent", () => {
    const out = rs().evaluate({ slices: [slice("S1", ["S9"]), slice("S2")] });
    assert.deepEqual(out.ready, ["S2"]);
    assertExcluded(out, "S1", /missing/i, "S9");
  });

  it("negative: write overlap with an in-flight or held slice is excluded, disjoint work continues", () => {
    for (const state of ["DISPATCHED", "HELD", "RESERVED"]) {
      const out = rs().evaluate({
        slices: [slice("S1", [], ["hooks/x.cjs"]), slice("S2", [], ["hooks/x.cjs", "hooks/y.cjs"]), slice("S3", [], ["hooks/z.cjs"])],
        assignments: { S1: state },
      });
      assert.deepEqual(out.ready, ["S3"], state);
      assertExcluded(out, "S2", /overlap/i, "S1");
    }
  });

  it("negative: a directory write-set entry overlaps files beneath it", () => {
    const out = rs().evaluate({
      slices: [slice("S1", [], ["repo: docs/"]), slice("S2", [], ["repo: docs/a.md"]), slice("S3", [], ["repo: docsx/a.md"])],
      assignments: { S1: "DISPATCHED" },
    });
    assert.deepEqual(out.ready, ["S3"]);
    assertExcluded(out, "S2", /overlap/i, "S1");
  });

  it("negative: two undispatched slices with overlapping write sets are never both ready", () => {
    const out = rs().evaluate({ slices: [slice("S1", [], ["hooks/x.cjs"]), slice("S2", [], ["hooks/x.cjs"]), slice("S3")] });
    assert.ok(out.ready.includes("S3"));
    assert.equal(["S1", "S2"].filter((id) => out.ready.includes(id)).length, 1, JSON.stringify(out));
    const loser = out.ready.includes("S1") ? "S2" : "S1";
    assertExcluded(out, loser, /overlap/i);
  });

  it("negative: a busy shared resource excludes only slices that need it", () => {
    const out = rs().evaluate({
      slices: [slice("S1", [], undefined, { resource_groups: ["lock:journey.lock"] }), slice("S2", [], undefined, { resource_groups: ["port:0"] }), slice("S3")],
      busy_resources: ["lock:journey.lock"],
    });
    assert.deepEqual(out.ready, ["S2", "S3"]);
    assertExcluded(out, "S1", /resource/i, "lock:journey.lock");
  });

  it("no global block: one held slice leaves every independent slice ready", () => {
    const slices = Array.from({ length: 128 }, (_, i) => slice(`S${i + 1}`));
    const out = rs().evaluate({ slices, assignments: { S1: "HELD" } });
    assert.equal(out.ready.length, 127);
    assert.deepEqual(out.excluded.map((e) => e.slice), ["S1"]);
  });

  it("is pure: inputs are not mutated", () => {
    const input = { slices: [slice("S1"), slice("S2", ["S1"])], assignments: { S1: "HELD" }, pending: [], busy_resources: [] };
    const before = structuredClone(input);
    rs().evaluate(input);
    assert.deepEqual(input, before);
  });
});

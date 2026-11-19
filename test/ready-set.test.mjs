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
import { spawnSync } from "node:child_process";
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
  it("admits a later wave only after its external prerequisite completes and serializes its shared groups", (t) => {
    const dir = tempDir(t, "cross-wave-");
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({
      waves: [{ id: "W2", slice_ids: ["A", "B", "C"] }],
      slices: [
        slice("A", ["prior"], ["repo: a"], { resource_groups: ["shared"] }),
        slice("B", ["prior"], ["repo: b"], { resource_groups: ["shared"] }),
        slice("C", [], ["repo: c"]),
      ],
    }));
    writeFileSync(path.join(dir, "seit.json"), JSON.stringify({ procedures_and_commands: [] }));
    const { slices } = waveView(dir, "W2");
    assert.deepEqual(rs().evaluate({ slices, assignments: { prior: "HELD" } }).ready, ["C"]);
    const next = rs().evaluate({ slices, assignments: { prior: "COMPLETED" } });
    assert.deepEqual(next.ready, ["A", "C"]);
    assertExcluded(next, "B", /resource/i, "shared");
    const active = rs().evaluate({ slices, assignments: { prior: "COMPLETED", A: "DISPATCHED" } });
    assert.deepEqual(active.ready, ["C"]);
    assertExcluded(active, "B", /resource/i, "shared");
  });

  it("does not schedule two assignments for the same directory write set", () => {
    const out = rs().evaluate({ slices: [slice("A", [], ["repo: src/"]), slice("B", [], ["repo: src/"])] });
    assert.deepEqual(out.ready, ["A"]);
    assertExcluded(out, "B", /overlap/i, "A");
  });

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

describe("real inputs and held resource scheduling (Alphazedehq#608)", () => {
  it("schedules across the frozen graph while holding cross-wave inputs, resources, and explicit edges", (t) => {
    const dir = tempDir(t, "graph-608-");
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({
      waves: [
        { id: "W1", slice_ids: ["produce", "collect"] },
        { id: "W2", slice_ids: ["report", "shared", "ordered"], slices: [
          slice("independent", [], ["free.md"], { resource: "host:c" }),
        ] },
      ],
      slices: [
        slice("produce", [], ["output.json"], { resource: "host:a" }),
        slice("collect", [], ["collection.md"]),
        slice("report", [], ["report.md"], { inputs: ["output.json"] }),
        slice("shared", [], ["different.md"], { resource: "host:a" }),
        slice("ordered", [], ["ordered.md"]),
      ],
      dependencies: [{ from: "produce", to: "ordered" }],
    }));
    function schedule(state) {
      const cli = spawnSync(process.execPath, [path.join(ROOT, "hooks/plan-package.cjs"), "ready", dir], {
        input: JSON.stringify(state), encoding: "utf8",
      });
      assert.equal(cli.status, 0, cli.stderr || cli.stdout);
      return JSON.parse(cli.stdout);
    }
    const active = schedule({ assignments: { produce: "DISPATCHED" } });
    assert.deepEqual(active.ready, ["collect", "independent"]);
    assertExcluded(active, "report", /input/, "output.json");
    assertExcluded(active, "shared", /resource/, "host:a");
    assertExcluded(active, "ordered", /dependency/, "produce");
    const done = schedule({ assignments: { produce: "COMPLETED", collect: "COMPLETED" } });
    assert.deepEqual(done.ready, ["report", "shared", "ordered", "independent"]);
  });

  it("starts every slice whose inputs are met and whose held resource is free, without serializing across resources", () => {
    const slices = [
      slice("i7-preserve", [], ["i7/preserve.log"], { inputs: [], resource: "host:i7" }),
      slice("i7-delete", [], ["i7/delete.log"], { inputs: ["i7-preserve"], resource: "host:i7" }),
      slice("i7-install", [], ["i7/install.log"], { inputs: [], resource: "host:i7" }),
      slice("mac-preserve", [], ["mac/preserve.log"], { inputs: [], resource: "host:mac" }),
      slice("mac-delete", [], ["mac/delete.log"], { inputs: ["mac-preserve"], resource: "host:mac" }),
    ];
    const start = rs().evaluate({ slices, assignments: {} });
    assert.deepEqual(start.ready, ["i7-preserve", "mac-preserve"]);
    assertExcluded(start, "i7-delete", /input/i, "i7-preserve");
    assertExcluded(start, "i7-install", /resource/i, "host:i7");
    assertExcluded(start, "mac-delete", /input/i, "mac-preserve");

    const mid = rs().evaluate({ slices, assignments: { "i7-preserve": "COMPLETED", "mac-preserve": "DISPATCHED" } });
    assert.deepEqual(mid.ready, ["i7-delete"]);
    assertExcluded(mid, "i7-install", /resource/i, "host:i7");
    assertExcluded(mid, "mac-delete", /input/i, "mac-preserve");

    const next = rs().evaluate({
      slices,
      assignments: { "i7-preserve": "COMPLETED", "i7-delete": "COMPLETED", "mac-preserve": "COMPLETED" },
    });
    assert.deepEqual(next.ready, ["i7-install", "mac-delete"]);
  });

  it("blocks a slice whose declared input is produced by an uncompleted slice write_set or missing from available_inputs", () => {
    const slices = [
      slice("produce", [], ["build/out.json"], { inputs: [], resource: "wt:a" }),
      slice("consume", [], ["build/next.json"], { inputs: ["build/out.json"], resource: "wt:b" }),
      slice("ext", [], ["build/ext.json"], { inputs: ["artifact:seed"], resource: "wt:c" }),
    ];
    const missingAvail = rs().evaluate({ slices, assignments: {}, available_inputs: [] });
    assert.deepEqual(missingAvail.ready, ["produce"]);
    assertExcluded(missingAvail, "consume", /input/i, "build/out.json");
    assertExcluded(missingAvail, "ext", /input/i, "artifact:seed");

    const readyExt = rs().evaluate({ slices, assignments: { produce: "COMPLETED" }, available_inputs: ["artifact:seed"] });
    assert.deepEqual(readyExt.ready, ["consume", "ext"]);
  });

  it("requires evidence for an external input and admits an observed version before a later writer", () => {
    const missing = rs().evaluate({ slices: [slice("external", [], [], { inputs: ["seed.json"] })] });
    assert.deepEqual(missing.ready, []);
    assertExcluded(missing, "external", /input/, "seed.json");

    const slices = [
      slice("inspect", [], [], { inputs: ["config.json"] }),
      slice("update", ["inspect"], ["config.json"]),
    ];
    const observed = rs().evaluate({ slices, available_inputs: ["config.json"] });
    assert.deepEqual(observed.ready, ["inspect"]);
    assertExcluded(observed, "update", /dependency/, "inspect");

    const producerId = rs().evaluate({
      slices: [slice("produce"), slice("consume", [], [], { inputs: ["produce"] })],
      available_inputs: ["produce"],
    });
    assertExcluded(producerId, "consume", /input/, "produce");
  });

  it("waveView forwards slice inputs and resource to ready-set evaluation", (t) => {
    const dir = tempDir(t, "wave-608-");
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({
      waves: [{ id: "W1", slice_ids: ["A", "B", "C"] }],
      slices: [
        slice("A", [], ["a.txt"], { inputs: [], resource: "host:i7" }),
        slice("B", [], ["b.txt"], { inputs: ["A"], resource: "host:i7" }),
        slice("C", [], ["c.txt"], { inputs: [], resource: "host:mac" }),
      ],
    }));
    writeFileSync(path.join(dir, "seit.json"), JSON.stringify({ procedures_and_commands: [] }));
    const view = waveView(dir, "W1");
    assert.equal(view.outcome, "PASS", JSON.stringify(view.findings));
    assert.deepEqual(view.slices[0].inputs, []);
    assert.equal(view.slices[0].resource, "host:i7");
    const out = rs().evaluate({ slices: view.slices, assignments: {} });
    assert.deepEqual(out.ready, ["A", "C"]);
    assertExcluded(out, "B", /input/i, "A");
  });
});

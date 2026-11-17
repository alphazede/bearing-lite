// S09T (Bearing 3.0, W3): Coordinator duty migration, receiving components first.
// Oracle: boundary contract SM04 / F08 / F09 (sha256 568a2121...), SEIT-B30-218,
// SEIT-SM04-T, SEIT-SM04-X, SEIT-F09; B30-206, B30-217, B30-218, B30-219,
// B30-303, B30-504; duty table in model/coordinator-duty-migration.md (D1-D11).
//
// The Coordinator stays shipped in W3 (SM04.X1). Each duty D1-D9 and D11 gets
// (a) a behaviour test through its receiving component's public entry point and
// (b) one row in the Orchestrator-owned migration reference that names the
// Implementation Orchestrator and that component. D10 is profile compatibility,
// not a duty; its proof is the freeze of legacy Coordinator profiles (F09).
//
// Text contract for `skills/bearing-lite/references/coordinator-migration.md`:
//   - one markdown table row per duty, starting `| D<n> |`, for D1-D11;
//   - each duty row (not D10) names `Implementation Orchestrator`, cites its
//     receiving component by plugin-root path (RECEIVERS below) and does not
//     name the Coordinator (one owner per duty, SM04.X3);
//   - prose states: the Coordinator stays available until every duty and
//     profile proof passes (X1); a frozen legacy route is never silently
//     rewritten (X2); one owner per duty, never run both owners (X3); the
//     Implementation Orchestrator alone dispatches, schedules and escalates (B30-303).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { boundHook } from "./task-opt-in-fixture.mjs";
import { ROOT, readShipped, assertLocalLinksResolve } from "./skill-contract-fixture.mjs";
import { validateSkillDocument } from "./skills-conformance.test.mjs";

const require = createRequire(import.meta.url);
const hook = (rel) => require(path.join(ROOT, rel));
const REF = "skills/bearing-lite/references/coordinator-migration.md";

/** Receiving component per duty (model/coordinator-duty-migration.md duty table). */
const RECEIVERS = Object.freeze({
  D1: ["hooks/ready-set.cjs"],
  D2: ["hooks/plan-package.cjs"],
  D3: ["hooks/ready-set.cjs"],
  D4: ["hooks/reconcile.cjs"],
  D5: ["hooks/write-set-check.cjs"],
  D6: ["hooks/dispatch-record.cjs"],
  D7: ["tools/render-dod-manifest.mjs", "hooks/orchestrator-write-lock.cjs"],
  D8: ["hooks/assurance-budget.cjs"],
  D9: ["hooks/owner-stops.cjs"],
  D11: ["tools/lifecycle-pool.mjs"],
});
const DUTIES = Object.keys(RECEIVERS);

function tempRoot(t, tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `coord-migration-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function rows(text) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(D\d+)\s*\|/);
    if (m) out.set(m[1], [...(out.get(m[1]) || []), line]);
  }
  return out;
}
const flatText = (text) => text.replace(/[`*]/g, "").replace(/\s+/g, " ");

describe("SM04.T1 duty inventory: one destination per duty (B30-217, SEIT-SM04-T)", () => {
  it("migration reference ships and its local links resolve", () => {
    readShipped(REF);
    assertLocalLinksResolve(REF);
  });

  it("each duty D1-D9 and D11 has exactly one row naming the Implementation Orchestrator and its shipped receiver", () => {
    const table = rows(readShipped(REF));
    for (const duty of DUTIES) {
      const found = table.get(duty) || [];
      assert.equal(found.length, 1, `${duty} must have exactly one row`);
      assert.match(found[0], /Implementation Orchestrator/, `${duty} receiving owner`);
      for (const rel of RECEIVERS[duty]) {
        assert.ok(found[0].includes(rel), `${duty} row must cite ${rel}`);
        assert.ok(existsSync(path.join(ROOT, rel)), `${rel} must ship`);
      }
    }
  });

  it("D10 is recorded as profile compatibility through hooks/profiles.cjs, not a duty", () => {
    const found = rows(readShipped(REF)).get("D10") || [];
    assert.equal(found.length, 1, "D10 must have exactly one row");
    assert.ok(found[0].includes("hooks/profiles.cjs"));
    assert.match(found[0], /compatib/i);
  });
});

describe("SM04.T2 receiving behaviour proven per duty (B30-218, SEIT-B30-218)", () => {
  const slice = (id, over = {}) => ({ id, depends_on: [], write_set: [`src/${id}.js`], ...over });

  it("D1 wave scheduling: independent slices are all ready; a busy resource holds only its slice", () => {
    const out = hook("hooks/ready-set.cjs").evaluate({
      slices: [slice("A"), slice("B"), slice("C", { resource_groups: ["port-pool"] })],
      assignments: {},
      busy_resources: ["port-pool"],
    });
    assert.deepEqual(out.ready, ["A", "B"]);
    assert.deepEqual(out.excluded, [{ slice: "C", cause: "resource", by: "port-pool" }]);
  });

  it("D2 wave receipts and task graph: the wave reader returns one wave's slices and resolved commands", (t) => {
    const dir = tempRoot(t, "d2");
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({
      waves: [{ id: "W1", slice_ids: ["S1", "S2"], exit_command_ids: ["CMD-A"] }, { id: "W2", slice_ids: ["S3"] }],
      slices: [slice("S1", { command_ids: ["CMD-A"] }), slice("S2", { depends_on: ["S1"] }), slice("S3")],
    }));
    writeFileSync(path.join(dir, "seit.json"), JSON.stringify({ procedures_and_commands: [{ id: "CMD-A", command: "node --test", pass: "exit 0" }] }));
    const view = hook("hooks/plan-package.cjs").waveView(dir, "W1");
    assert.equal(view.outcome, "PASS", JSON.stringify(view.findings));
    assert.deepEqual(view.slices.map((s) => s.id), ["S1", "S2"]);
    assert.deepEqual(view.slices[0].commands, [{ id: "CMD-A", command: "node --test", pass: "exit 0" }]);
    assert.deepEqual(view.exit_commands.map((c) => c.id), ["CMD-A"]);
    assert.equal(hook("hooks/plan-package.cjs").waveView(dir, "W9").outcome, "FAIL");
  });

  it("D3 dependency checks: an unmet or missing dependency keeps a slice out of the ready set", () => {
    const evaluate = hook("hooks/ready-set.cjs").evaluate;
    const graph = [slice("A"), slice("B", { depends_on: ["A"] }), slice("C", { depends_on: ["Z"] })];
    const before = evaluate({ slices: graph, assignments: {} });
    assert.deepEqual(before.ready, ["A"]);
    assert.deepEqual(before.excluded, [
      { slice: "B", cause: "dependency", by: "A" },
      { slice: "C", cause: "missing dependency", by: "Z" },
    ]);
    assert.deepEqual(evaluate({ slices: graph, assignments: { A: "COMPLETED" } }).ready, ["B"]);
  });

  it("D4 lease checks: a stale generation is rejected and leaves journey state unchanged", () => {
    const { applyEvent } = hook("hooks/reconcile.cjs");
    const state = { journey: "j-1", repository: "r", generation: 2, version: 0, applied_event_ids: [], slices: {} };
    const event = (generation, id) => ({
      schema_version: 1, event_id: id, source: "test", journey: "j-1", repository: "r",
      unit: { wave: "W1", slice: "S1" }, candidate_revision: "rev-a", generation,
      evidence: { ref: `evidence/${id}`, sha256: "a".repeat(64) },
      transition: { kind: "implementation", verdict: "PASS" }, occurred_at: "2026-11-17T12:00:00Z",
    });
    const stale = applyEvent(state, event(1, "old"));
    assert.equal(stale.receipt.code, "stale_generation");
    assert.equal(stale.receipt.applied, false);
    assert.deepEqual(stale.state.slices, {});
    assert.equal(applyEvent(state, event(2, "current")).receipt.applied, true);
  });

  it("D5 write-set checks: an empty set, a missing path or a whitespace error fails the return check", (t) => {
    const dir = tempRoot(t, "d5");
    const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(path.join(dir, "owned.txt"), "ok\n");
    git("add", "owned.txt");
    git("commit", "-qm", "owned");
    const { check } = hook("hooks/write-set-check.cjs");
    assert.equal(check(dir, ["owned.txt"]).outcome, "PASS");
    assert.deepEqual(check(dir, []).findings, [{ code: "empty_write_set" }]);
    assert.deepEqual(check(dir, ["absent.txt"]).findings, [{ path: "absent.txt", code: "missing_path" }]);
    writeFileSync(path.join(dir, "owned.txt"), "trailing \n");
    const dirty = check(dir, ["owned.txt"]);
    assert.equal(dirty.outcome, "FAIL");
    assert.equal(dirty.findings[0].code, "whitespace");
  });

  it("D6 event dispatch: a replayed reserve reuses the open attempt; no second launch", (t) => {
    const file = path.join(tempRoot(t, "d6"), "journey.json");
    writeFileSync(file, JSON.stringify({ schema_version: 1, journey: "J1" }) + "\n");
    const { transition, read } = hook("hooks/dispatch-record.cjs");
    const key = { journey: "J1", wave: "W3", slice: "S1", role: "implementer", generation: 1 };
    const reserve = () => transition(file, {
      key, type: "reserve", candidate_revision: "rev-a", route: "primary", routes: ["primary"],
      launch_digest: "d".repeat(64), lease: { generation: 1, branch: "slice/s1" },
      limits: { invocation: 2, review: 1, repair: 1 }, authorized: true,
    });
    assert.equal(reserve().outcome, "PASS");
    const before = readFileSync(file);
    assert.notEqual(reserve().outcome, "PASS");
    assert.deepEqual(readFileSync(file), before, "refused replay writes nothing");
    assert.equal(read(file, key).attempts.length, 1);
  });

  it("D7 evidence integration: the Orchestrator writes implementation.json and the Manifest; a specialist may not", () => {
    const lock = boundHook(hook("hooks/orchestrator-write-lock.cjs"));
    const files = ["docs/plans/example/implementation.json", "docs/plans/example/example-dod-manifest.html"];
    for (const file of files) {
      assert.equal(lock.evaluate({ role: "orchestrator", paths: [file] }).verdict, "ALLOW", file);
      assert.equal(lock.evaluate({ role: "test_engineer", paths: [file] }).verdict, "DENY_DISPATCH", file);
    }
  });

  it("D8 review dispatch: the wave-boundary review round is available once, then halts", (t) => {
    const dir = tempRoot(t, "d8");
    const slot = { id: "review-a", kind: "review", group: "round-1", unit_id: "W1", candidate: "c", scope: "s", tool_name: "Bash", tool_input: { command: "true" } };
    writeFileSync(path.join(dir, "implementation.json"), JSON.stringify({ waves: [{ id: "W1" }], journey_settings: { lifecycle_id: "J", assurance_dispatch: { slots: [slot] } } }));
    const record = (rounds) => writeFileSync(path.join(dir, "task-record.json"), JSON.stringify({
      journey: "J", dispatch_log: [], amendments: [],
      units: [{ unit_kind: "wave", unit_id: "W1", assurance_rounds: rounds, assurance_repairs: 0, receipts: [{ kind: "gate_chain", unit_id: "W1", verdict: "PASS" }] }],
    }));
    const request = { declaration_path: path.join(dir, "implementation.json"), task_record_path: path.join(dir, "task-record.json"), journey: "J", assurance_unit: "W1", unit_kind: "wave" };
    const { evaluateAssuranceBudget } = hook("hooks/assurance-budget.cjs");
    record(0);
    assert.equal(evaluateAssuranceBudget(request).outcome, "PASS");
    record(1);
    assert.equal(evaluateAssuranceBudget(request).outcome, "HALT");
  });

  it("D9 bounded escalation: owner-boundary classes ask or queue; an ungranted continuation is not CONTINUE", () => {
    const { evaluateOwnerStop } = hook("hooks/owner-stops.cjs");
    assert.equal(evaluateOwnerStop({ class: "C", blocking: true, evidence_ref: "e" }).disposition, "ASK");
    assert.equal(evaluateOwnerStop({ class: "E", blocking: false, evidence_ref: "e" }).disposition, "QUEUE");
    assert.equal(evaluateOwnerStop({ class: "A", blocking: true, evidence_ref: "e", authority: {} }).disposition, "NEEDS_MORE_EVIDENCE");
  });

  it("D11 storage cleanup: the pool tool leases, reports and releases a branch-only slot", (t) => {
    const repo = tempRoot(t, "d11-repo");
    const pool = tempRoot(t, "d11-pool");
    const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, stdio: "pipe" });
    git("init", "-q");
    writeFileSync(path.join(repo, "a.txt"), "a\n");
    git("add", "a.txt");
    git("commit", "-qm", "init");
    const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, "tools/lifecycle-pool.mjs"), ...args], { encoding: "utf8", timeout: 30000 });
    const lease = cli("lease", "--pool", pool, "--repo", repo, "--owner", "S1", "--branch", "slice/s1", "--worktree", path.join(pool, "wt"), "--branch-only");
    assert.equal(lease.status, 0, lease.stderr);
    assert.match(cli("status", "--pool", pool).stdout, /"S1"/);
    const release = cli("release", "--pool", pool, "--owner", "S1");
    assert.equal(release.status, 0, release.stderr);
    assert.equal(cli("recover", "--pool", pool, "--dry-run").status, 0);
  });
});

describe("SM04.X1-X3 and B30-303: removal blocked, legacy routes kept, one owner per duty (SEIT-SM04-X)", () => {
  it("SM04.X1 the Coordinator skill stays shipped and valid until every proof passes", () => {
    const text = readShipped("skills/coordinator/SKILL.md");
    assert.equal(validateSkillDocument("coordinator", text).ok, true);
    assert.match(flatText(readShipped(REF)), /Coordinator[^.]*\b(stays|remains) available\b[^.]*\buntil\b/i);
  });

  it("SM04.X2 the reference forbids silently rewriting a frozen legacy route", () => {
    assert.match(flatText(readShipped(REF)), /never (silently )?rewrit\w*[^.]*frozen/i);
  });

  it("SM04.X3 one owner per duty: no duty row names the Coordinator; both owners never run", () => {
    const text = readShipped(REF);
    const table = rows(text);
    for (const duty of DUTIES) {
      for (const row of table.get(duty) || [""]) assert.doesNotMatch(row, /Coordinator/, `${duty} row names one owner`);
    }
    assert.match(flatText(text), /one owner per duty/i);
    assert.match(flatText(text), /never run both/i);
  });

  it("B30-303 the Implementation Orchestrator alone dispatches, schedules and escalates", () => {
    assert.match(flatText(readShipped(REF)), /Implementation Orchestrator alone/i);
  });
});

describe("F09 legacy Coordinator profile compatibility (B30-219, B30-504, SEIT-F09)", () => {
  const route = (h) => ({ enabled: true, primary: { harness: h, model: `${h}-model`, reasoning: "high" }, ordered_fallbacks: [] });
  const profile = (coordinator, assuranceRepair) => {
    const p = { roles: { implementer: route("h-impl"), reviewer: route("h-rev") } };
    if (coordinator !== undefined) p.roles.coordinator = { ...route("h-coord"), enabled: coordinator };
    if (assuranceRepair !== undefined) p.assurance_repair = { enabled: assuranceRepair };
    return p;
  };

  for (const coordinator of [true, false, undefined]) {
    for (const assuranceRepair of [undefined, false, true]) {
      it(`coordinator ${coordinator ?? "absent"}, assurance_repair ${assuranceRepair ?? "absent"}: freeze resolves without mutation or loss`, () => {
        const { freezeSelectedRoutes } = hook("hooks/profiles.cjs");
        const input = profile(coordinator, assuranceRepair);
        const bytes = JSON.stringify(input);
        const frozen = freezeSelectedRoutes({ profile: input });
        assert.equal(JSON.stringify(input), bytes, "source profile unchanged");
        assert.match(frozen.digest, /^[0-9a-f]{64}$/);
        assert.deepEqual(frozen.snapshot.roles, input.roles, "every role route, Coordinator included, preserved");
        assert.deepEqual(frozen.snapshot.assurance_repair, input.assurance_repair, "absent stays absent; present is copied");
        assert.equal(freezeSelectedRoutes({ profile: JSON.parse(bytes) }).digest, frozen.digest, "byte-stable binding");
      });
    }
  }
});

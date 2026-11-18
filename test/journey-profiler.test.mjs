/**
 * Journey profiler (Bearing 3.0 S01T, test-first for S01).
 * Drives tools/journey-profiler.mjs only through its command line over the
 * synthetic fixtures in test/fixtures/journey-profiler (interface and hand
 * totals: that README). Oracles: B30-102..106, B30-110, B30-112, B30-123,
 * B30-131, B30-230; boundary contract F01, F02, SM01, TB01; workspace
 * Quantity definitions (DEC-07).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "tools", "journey-profiler.mjs");
const SCHEMA = path.join(ROOT, "schemas", "journey-profile.schema.json");
const FX = path.join(ROOT, "test", "fixtures", "journey-profiler");
const fx = (name) => path.join(FX, name);
const AS_OF = "2026-11-10T13:00:00Z";
const CANARIES = ["CANARY-SECRET-b30103", "CANARY-PROMPT-b30103", "CANARY-TOOL-b30103"];
const UNQUALIFIED = ["agy", "cursor-agent", "deepcode", "muse-code", "omp", "pi"];
// F01 internal_only values (session ids, checkout paths, branch) and fixture locations.
const INTERNAL = ["sess-", "/work/alpha", "/work/plan", "/elsewhere", "slice/alpha", FX];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(args, nodeFlags = []) {
  const r = spawnSync(process.execPath, [...nodeFlags, CLI, ...args], { encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function tempRoot(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "journey-profiler-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const journeys = (...names) => names.flatMap((n) => ["--journey", fx(n)]);
const hostLog = (harness, file) => ["--host-log", `${harness}=${fx(file)}`];
// DEC-57: a host is qualified only by an explicit record whose controlled-session totals match host_reported.
const qual = (harness, file) => ["--host-qualification", `${harness}=${fx(file)}`];
const CLAUDE = [...hostLog("claude-code", "claude-code.jsonl"), ...qual("claude-code", "qualification-claude-code.json")];
const CODEX = [...hostLog("codex", "codex.jsonl"), ...qual("codex", "qualification-codex.json")];
const BASE_INPUTS = [
  ...journeys("journey-alpha.json", "journey-beta.json"),
  "--events", fx("events.jsonl"),
  "--receipt", fx("receipt-reviewer.json"),
];
const ALL_HOSTS = [
  ...CLAUDE,
  ...CODEX,
  ...UNQUALIFIED.flatMap((h) => hostLog(h, "other-host.jsonl")),
];

it("does not qualify a host from an empty controlled log and zero claimed totals", (t) => {
  const dir = tempRoot(t);
  const log = path.join(dir, "empty.jsonl");
  const qualification = path.join(dir, "qualification.json");
  writeFileSync(log, "");
  writeFileSync(qualification, JSON.stringify({
    harness: "claude-code",
    controlled_session_log: "empty.jsonl",
    host_reported: { fresh_tokens: 0, cache_read_tokens: 0 },
  }));
  const { json } = profile(t, [...BASE_INPUTS, ...hostLog("claude-code", "claude-code.jsonl")],
    ["--host-qualification", `claude-code=${qualification}`]);
  assert.equal(json.hosts["claude-code"].status, "unavailable");
  assert.ok(json.usage.length > 0);
  for (const row of json.usage) assertUnavailable(row.metrics.fresh_tokens, "empty control log");
});

function profile(t, inputs, extra = []) {
  const out = path.join(tempRoot(t), "out");
  const r = run(["profile", ...inputs, "--as-of", AS_OF, "--out", out, ...extra]);
  assert.equal(r.status, 0, `profile failed: ${r.error ?? ""}${r.stderr}`);
  const bytes = readFileSync(path.join(out, "profile.json"), "utf8");
  const report = readFileSync(path.join(out, "report.md"), "utf8");
  return { out, run: r, bytes, report, json: JSON.parse(bytes) };
}

function num(metric, label) {
  assert.equal(typeof metric?.value, "number", `${label}: expected a number, got ${JSON.stringify(metric)}`);
  return metric.value;
}

function assertUnavailable(metric, label) {
  assert.equal(metric?.value, "unavailable", `${label}: expected unavailable, got ${JSON.stringify(metric)}`);
  assert.equal(typeof metric.reason, "string", `${label}: unavailable needs a coverage reason`);
  assert.ok(metric.reason.length > 0, `${label}: empty coverage reason`);
}

function rows(p, match) {
  return p.usage.filter((row) => Object.entries(match).every(([k, v]) => row[k] === v));
}

function oneRow(p, match) {
  const found = rows(p, match);
  assert.equal(found.length, 1, `expected one usage row for ${JSON.stringify(match)}, got ${JSON.stringify(found)}`);
  return found[0];
}

function journeyRow(p, id) {
  const found = p.journeys.filter((j) => j.journey === id);
  assert.equal(found.length, 1, `expected one journey row for ${id}`);
  return found[0];
}

function assertNoLeak(texts, needles, where) {
  for (const [name, text] of Object.entries(texts)) {
    for (const needle of needles) {
      assert.equal(text.includes(needle), false, `${where}: ${name} contains ${needle}`);
    }
  }
}

function filesIn(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("journey profiler: join labels and aggregation (B30-104, B30-106, SM01.T2-T5, F01)", () => {
  it("labels and totals every Claude Code cell against the hand totals", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]).json;
    assert.equal(p.hosts["claude-code"].status, "qualified");

    const bound = oneRow(p, { harness: "claude-code", model: "model-a" });
    assert.deepEqual([bound.attribution, bound.journey, bound.role, bound.stage], ["bound", "jrn-alpha", "reviewer", "review"]);
    assert.equal(num(bound.metrics.model_calls, "bound calls"), 2, "lines sharing one message id are one call");
    assert.equal(num(bound.metrics.fresh_tokens, "bound fresh"), 1650);
    assert.equal(num(bound.metrics.cache_read_tokens, "bound cache read"), 11000);

    const inferred = oneRow(p, { harness: "claude-code", model: "model-b" });
    assert.deepEqual([inferred.attribution, inferred.journey], ["inferred", "jrn-alpha"]);
    assert.equal(inferred.role, null, "inferred join must not invent a role");
    assert.equal(inferred.stage, null, "inferred join must not invent a stage");
    assert.equal(num(inferred.metrics.fresh_tokens, "inferred fresh"), 77);
    assert.equal(num(inferred.metrics.cache_read_tokens, "inferred cache read"), 33);

    const unattributed = oneRow(p, { harness: "claude-code", model: "model-c" });
    assert.deepEqual([unattributed.attribution, unattributed.journey], ["unattributed", null],
      "no lease match and an ambiguous two-lease match stay unattributed");
    assert.equal(num(unattributed.metrics.model_calls, "unattributed calls"), 2);
    assert.equal(num(unattributed.metrics.fresh_tokens, "unattributed fresh"), 25);
    assert.equal(num(unattributed.metrics.cache_read_tokens, "unattributed cache read"), 5);

    for (const row of p.usage) {
      assert.ok(["bound", "inferred", "unattributed"].includes(row.attribution), `row without a join label: ${JSON.stringify(row)}`);
    }
  });

  it("reports elapsed, owner wait and idle time per journey, unavailable where not exposed", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]).json;
    const alpha = journeyRow(p, "jrn-alpha").metrics;
    assert.equal(num(alpha.elapsed_time, "alpha elapsed"), 6300);
    assert.equal(num(alpha.owner_wait_time, "alpha owner wait"), 900, "union of overlapping blocked intervals, seconds");
    assertUnavailable(alpha.agent_idle_time, "alpha idle without dispatch times");

    const beta = journeyRow(p, "jrn-beta").metrics;
    assertUnavailable(beta.elapsed_time, "beta elapsed without events");
    assertUnavailable(beta.owner_wait_time, "beta owner wait not tracked");
    assertUnavailable(beta.agent_idle_time, "beta idle");
  });

  it("computes cohort ratios from attributed usage only and marks zero denominators unavailable (F02)", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]).json;
    assert.equal(num(p.cohort.tokens_per_completed_journey, "per completed journey"), 1727);
    assert.equal(num(p.cohort.tokens_per_integrated_slice, "per integrated slice"), 863.5);

    const betaOnly = profile(t, [...journeys("journey-beta.json"), "--events", fx("events.jsonl"),
      ...CLAUDE]).json;
    assertUnavailable(betaOnly.cohort.tokens_per_completed_journey, "no completed journey");
    assertUnavailable(betaOnly.cohort.tokens_per_integrated_slice, "no merged slice");
  });

  it("counts a shared slice ID separately for each journey that integrated it", (t) => {
    const events = readFileSync(fx("events.jsonl"), "utf8");
    const merge = events.trim().split("\n").map(JSON.parse).find((event) => event.event_id === "ev-2");
    const file = path.join(tempRoot(t), "events.jsonl");
    writeFileSync(file, events + JSON.stringify({ ...merge, journey: "jrn-beta", event_id: "ev-beta-1" }) + "\n");
    const p = profile(t, [...BASE_INPUTS, "--events", file, ...CLAUDE]).json;
    assert.equal(num(p.cohort.tokens_per_integrated_slice, "α S1 and S2, β S1"), 1727 / 3);
  });

  it("leaves a session with conflicting receipt stages unattributed", (t) => {
    const receipt = JSON.parse(readFileSync(fx("receipt-reviewer.json"), "utf8"));
    const other = path.join(tempRoot(t), "receipt.json");
    writeFileSync(other, JSON.stringify({ ...receipt, stage: "planning" }));
    const p = profile(t, [...BASE_INPUTS, "--receipt", other, ...CLAUDE]).json;
    const row = oneRow(p, { model: "model-a" });
    assert.deepEqual([row.attribution, row.journey, row.role, row.stage], ["unattributed", null, null, null]);
  });

  it("marks the owner-ask rate unavailable when no evaluated-decision record is supplied (B30-230)", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]).json;
    assertUnavailable(p.owner_ask_rate, "owner ask rate without decisions");
  });

  it("prints every join label in the concise report and marks inferred usage as inference", (t) => {
    const { report } = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    for (const label of ["bound", "inferred", "unattributed"]) {
      assert.match(report, new RegExp(`\\b${label}\\b`), `report lacks ${label}`);
    }
    assert.match(report, /\binference\b/i, "report must say inferred attribution is an inference");
  });

  it("reports counts for each attribution label, including empty groups", (t) => {
    const full = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    assert.match(full.report, /Attribution rows: bound 1, inferred 1, unattributed 1\./);
    const empty = profile(t, BASE_INPUTS);
    assert.match(empty.report, /Attribution rows: bound 0, inferred 0, unattributed 0\./);
  });
});

describe("journey profiler: host normalization and unavailable markers (B30-105, SM01.X2, SEIT-HOSTNORM-*)", () => {
  it("reports an observed zero cache-read total as measured", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...hostLog("claude-code", "claude-code-malformed.jsonl"), ...qual("claude-code", "qualification-claude-code.json")]);
    const row = oneRow(p.json, { model: "model-d" });
    assert.equal(num(row.metrics.cache_read_tokens, "observed cache reads"), 0);
    assert.equal(run(["validate", path.join(p.out, "profile.json")]).status, 0);
  });

  it("reports Codex per-call usage once or not at all, never a guessed or double-counted number", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...hostLog("codex", "codex.jsonl")]).json;
    const codex = rows(p, { harness: "codex" });
    for (const row of codex) assert.deepEqual([row.attribution, row.journey], ["inferred", "jrn-alpha"]);
    if (p.hosts.codex.status === "unavailable") {
      assert.ok(p.hosts.codex.reason, "unqualified host needs a coverage reason");
      for (const row of codex) for (const [k, m] of Object.entries(row.metrics)) assertUnavailable(m, `codex ${k}`);
    } else {
      assert.equal(p.hosts.codex.status, "qualified");
      const sum = (k) => codex.reduce((s, row) => s + num(row.metrics[k], `codex ${k}`), 0);
      assert.equal(sum("model_calls"), 2);
      assert.equal(sum("fresh_tokens"), 800, "uncached input + cache write + output, per call, no thread totals");
      assert.equal(sum("cache_read_tokens"), 1000);
    }
  });

  for (const harness of UNQUALIFIED) {
    it(`marks every ${harness} metric unavailable until its reader is qualified`, (t) => {
      const p = profile(t, [...BASE_INPUTS, ...hostLog(harness, "other-host.jsonl")]).json;
      assert.equal(p.hosts[harness].status, "unavailable");
      assert.ok(p.hosts[harness].reason, `${harness} needs a coverage reason`);
      for (const row of rows(p, { harness })) {
        for (const [k, m] of Object.entries(row.metrics)) assertUnavailable(m, `${harness} ${k}`);
      }
    });
  }

  it("validates its own output and rejects 0 or null in place of an unavailable marker", (t) => {
    const { out, json } = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const file = path.join(out, "profile.json");
    assert.equal(run(["validate", file]).status, 0, "generated profile must be schema-valid");

    const idle = journeyRow(json, "jrn-alpha").metrics.agent_idle_time;
    assertUnavailable(idle, "precondition");
    for (const placeholder of [0, null]) {
      idle.value = placeholder;
      const edited = path.join(out, `edited-${placeholder}.json`);
      writeFileSync(edited, JSON.stringify(json));
      assert.notEqual(run(["validate", edited]).status, 0, `schema accepted ${placeholder} for an unexposed metric`);
    }
  });

  const hasJsonschema = spawnSync("python3", ["-c", "import jsonschema"]).status === 0;
  it("agrees with an independent Draft 2020-12 validator", { skip: !hasJsonschema && "python3 jsonschema not installed" }, (t) => {
    const { out, json } = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const check = (file) => spawnSync("python3", ["-I", "-c",
      "import json,sys,jsonschema;s=json.load(open(sys.argv[1]));jsonschema.Draft202012Validator.check_schema(s);" +
      "jsonschema.Draft202012Validator(s).validate(json.load(open(sys.argv[2])))", SCHEMA, file]).status;
    assert.equal(check(path.join(out, "profile.json")), 0);
    journeyRow(json, "jrn-alpha").metrics.agent_idle_time.value = 0;
    const edited = path.join(out, "edited.json");
    writeFileSync(edited, JSON.stringify(json));
    assert.notEqual(check(edited), 0);
  });
});

describe("journey profiler: host qualification from controlled-session records (SEIT-W1G-11-QUAL, B30-104, B30-105)", () => {
  const BOTH_LOGS = [...hostLog("claude-code", "claude-code.jsonl"), ...hostLog("codex", "codex.jsonl")];

  function assertNotQualified(p, harness, label) {
    assert.deepEqual(p.hosts[harness], { status: "unavailable", reason: "host_not_qualified" }, `${label}: ${harness} host`);
    const found = rows(p, { harness });
    assert.ok(found.length > 0, `${label}: ${harness} rows are still listed`);
    for (const row of found) for (const [k, m] of Object.entries(row.metrics)) assertUnavailable(m, `${label}: ${harness} ${k}`);
  }

  it("(a) never qualifies claude-code or codex by name alone", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS]).json;
    assertNotQualified(p, "claude-code", "no record");
    assertNotQualified(p, "codex", "no record");
  });

  it("(b) qualifies claude-code from its exact record and reports the hand totals", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS, ...qual("claude-code", "qualification-claude-code.json")]).json;
    assert.deepEqual(p.hosts["claude-code"], { status: "qualified" });
    const cells = [["model-a", 2, 1650, 11000], ["model-b", 2, 77, 33], ["model-c", 2, 25, 5]];
    for (const [model, calls, fresh, cacheRead] of cells) {
      const m = oneRow(p, { harness: "claude-code", model }).metrics;
      assert.deepEqual([num(m.model_calls, model), num(m.fresh_tokens, model), num(m.cache_read_tokens, model)],
        [calls, fresh, cacheRead], model);
    }
    assertNotQualified(p, "codex", "claude-code record only");
  });

  it("(c) leaves claude-code unavailable when host_reported differs by one token", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS, ...qual("claude-code", "qualification-claude-code-1651.json")]).json;
    assertNotQualified(p, "claude-code", "fresh_tokens 1651");
  });

  it("(d) qualifies only the harness whose record is supplied", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS, ...qual("codex", "qualification-codex.json")]).json;
    assert.deepEqual(p.hosts.codex, { status: "qualified" });
    const codex = rows(p, { harness: "codex" });
    const sum = (k) => codex.reduce((total, row) => total + num(row.metrics[k], `codex ${k}`), 0);
    assert.deepEqual([sum("model_calls"), sum("fresh_tokens"), sum("cache_read_tokens")], [2, 800, 1000]);
    assertNotQualified(p, "claude-code", "codex record only");
  });

  it("(d) does not let one harness's record qualify another", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS, ...qual("codex", "qualification-claude-code.json")]).json;
    assertNotQualified(p, "codex", "claude-code record passed for codex");
    assertNotQualified(p, "claude-code", "record passed under another harness");
  });

  it("(e) turns a malformed record into a diagnostic and leaves claude-code unavailable", (t) => {
    const before = profile(t, [...BASE_INPUTS, ...BOTH_LOGS]).json.diagnostics.map((d) => JSON.stringify(d));
    const p = profile(t, [...BASE_INPUTS, ...BOTH_LOGS, ...qual("claude-code", "qualification-malformed.json")]);
    assertNotQualified(p.json, "claude-code", "malformed record");
    const added = p.json.diagnostics.filter((d) => !before.includes(JSON.stringify(d)));
    assert.equal(added.length, 1, `expected one diagnostic for the record, got ${JSON.stringify(p.json.diagnostics)}`);
    assert.ok(added[0].code && added[0].source, "diagnostic needs a code and a source pseudonym");
    assertNoLeak({ "profile.json": p.bytes, "report.md": p.report, stdout: p.run.stdout, stderr: p.run.stderr },
      ["qualification-malformed.json", FX], "malformed record");
    assert.equal(run(["validate", path.join(p.out, "profile.json")]).status, 0);
  });
});

describe("journey profiler: allowlist readers and trust boundary (B30-102, B30-103, TB01, F01)", () => {
  it("keeps no canary, raw line, session id or path in any output and still reports the canary sessions", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...ALL_HOSTS]);
    const outputs = { "profile.json": p.bytes, "report.md": p.report, stdout: p.run.stdout, stderr: p.run.stderr };
    assertNoLeak(outputs, CANARIES, "default run");
    assertNoLeak({ "profile.json": p.bytes, "report.md": p.report }, INTERNAL, "default run");
    assert.equal(num(oneRow(p.json, { harness: "claude-code", model: "model-a" }).metrics.fresh_tokens, "canary session"), 1650);
  });

  it("records input hashes, never input paths (B30-109 reproducibility)", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]).json;
    const hashes = new Set(p.inputs.map((i) => i.sha256));
    for (const name of ["journey-alpha.json", "journey-beta.json", "events.jsonl", "receipt-reviewer.json", "claude-code.jsonl"]) {
      assert.ok(hashes.has(sha256(readFileSync(fx(name)))), `input hash missing for ${name}`);
    }
  });

  it("turns a malformed record into a structured diagnostic without the raw line and keeps the rest", (t) => {
    const p = profile(t, [...journeys("journey-alpha.json"), ...hostLog("claude-code", "claude-code-malformed.jsonl"), ...qual("claude-code", "qualification-claude-code.json")]);
    const diag = p.json.diagnostics.filter((d) => d.record_index === 2);
    assert.equal(diag.length, 1, `expected one diagnostic for line 2, got ${JSON.stringify(p.json.diagnostics)}`);
    assert.ok(diag[0].code && diag[0].source, "diagnostic needs a code and a source pseudonym");
    assertNoLeak({ "profile.json": p.bytes, "report.md": p.report, stdout: p.run.stdout, stderr: p.run.stderr },
      [...CANARIES, "claude-code-malformed.jsonl", FX], "malformed input");
    const row = oneRow(p.json, { harness: "claude-code", model: "model-d" });
    assert.equal(row.attribution, "unattributed");
    assert.equal(num(row.metrics.model_calls, "calls around bad line"), 2);
    assert.equal(num(row.metrics.fresh_tokens, "fresh around bad line"), 10);
  });

  it("gives the same profile and report bytes for the same inputs (SM01 ordering)", (t) => {
    const inputs = [...BASE_INPUTS, ...ALL_HOSTS];
    const a = profile(t, inputs);
    const b = profile(t, inputs);
    assert.equal(a.bytes, b.bytes);
    assert.equal(a.report, b.report);
  });

  it("leaves the previous profile intact when a run fails (F02 failure recovery)", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const r = run(["profile", ...BASE_INPUTS, ...CLAUDE, "--as-of", "yesterday", "--out", p.out]);
    assert.notEqual(r.status, 0, "a malformed --as-of must fail");
    assert.equal(readFileSync(path.join(p.out, "profile.json"), "utf8"), p.bytes);
    assert.equal(readFileSync(path.join(p.out, "report.md"), "utf8"), p.report);
  });

  it("keeps the previous profile when the report path cannot be replaced", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const report = path.join(p.out, "report.md");
    rmSync(report);
    mkdirSync(report);
    const r = run(["profile", ...BASE_INPUTS, ...ALL_HOSTS, "--as-of", AS_OF, "--out", p.out]);
    assert.notEqual(r.status, 0, "a report path that is a directory must fail");
    assert.equal(readFileSync(path.join(p.out, "profile.json"), "utf8"), p.bytes);
    assert.equal(statSync(report).isDirectory(), true);
  });
});

describe("journey profiler: opt-in and no model calls (B30-110, SM01.T1, SM01.X1)", () => {
  it("writes nothing and reads no host log for a journey without the profiler flag", (t) => {
    const root = tempRoot(t);
    const out = path.join(root, "out");
    // Read access covers only the tool and the flag-off journey: reading the host log would throw.
    const flags = ["--permission", `--allow-fs-read=${path.join(ROOT, "tools")}`, `--allow-fs-read=${path.join(ROOT, "hooks")}`,
      `--allow-fs-read=${path.join(ROOT, "schemas")}`, `--allow-fs-read=${fx("journey-off.json")}`, `--allow-fs-write=${root}`];
    const r = run(["profile", ...journeys("journey-off.json"), ...hostLog("claude-code", "claude-code.jsonl"),
      "--as-of", AS_OF, "--out", out], flags);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(filesIn(out), []);
  });

  it("produces a schema-valid profile and report under the permission model with no child process or worker", (t) => {
    const root = tempRoot(t);
    const out = path.join(root, "out");
    const flags = ["--permission", `--allow-fs-read=${path.join(ROOT, "tools")}`, `--allow-fs-read=${path.join(ROOT, "hooks")}`,
      `--allow-fs-read=${path.join(ROOT, "schemas")}`, `--allow-fs-read=${FX}`, `--allow-fs-read=${out}/*`, `--allow-fs-write=${root}`];
    const r = run(["profile", ...BASE_INPUTS, ...ALL_HOSTS, "--as-of", AS_OF, "--out", out], flags);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(path.join(out, "report.md"), "utf8").length > 0, "concise report missing");
    assert.equal(run(["validate", path.join(out, "profile.json")]).status, 0);
  });
});

describe("journey profiler: stage-boundary Orchestrator usage (B30-131)", () => {
  const boundary = (record, journey, stage, at, qualification = qual("claude-code", "qualification-claude-code.json")) =>
    run(["stage-boundary", "--journey", fx(journey), "--stage", stage, "--at", at,
      "--session", "sess-orch-1", ...hostLog("claude-code", "orchestrator-claude.jsonl"), ...qualification, "--record", record]);

  it("records call count and token counters per boundary, unavailable where the host omits one", (t) => {
    const record = path.join(tempRoot(t), "lifecycle.json");
    const before = sha256(readFileSync(fx("journey-alpha.json")));
    assert.equal(boundary(record, "journey-alpha.json", "planning", "2026-11-10T09:30:00Z").status, 0);
    assert.equal(boundary(record, "journey-alpha.json", "implementation", "2026-11-10T10:00:00Z").status, 0);
    const text = readFileSync(record, "utf8");
    const stages = JSON.parse(text).stage_boundaries;
    assert.deepEqual(stages.map((s) => s.stage), ["planning", "implementation"]);

    const [plan, impl] = stages.map((s) => s.orchestrator);
    assert.deepEqual(["model_calls", "input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens"]
      .map((k) => num(plan[k], `planning ${k}`)), [2, 12, 24, 36, 48]);
    assert.deepEqual(["model_calls", "input_tokens", "cache_read_tokens", "output_tokens"]
      .map((k) => num(impl[k], `implementation ${k}`)), [2, 11, 15, 19]);
    assertUnavailable(impl.cache_write_tokens, "cache write not exposed");

    assertNoLeak({ "lifecycle record": text }, [...CANARIES, "sess-orch-1", "/work/plan"], "stage boundary");
    assert.equal(sha256(readFileSync(fx("journey-alpha.json"))), before, "journey input must stay read-only");
  });

  it("reports the five Orchestrator counters only with the exact claude-code record (SEIT-W1G-11-QUAL)", (t) => {
    const keys = ["model_calls", "input_tokens", "cache_write_tokens", "cache_read_tokens", "output_tokens"];
    const counters = (qualification) => {
      const record = path.join(tempRoot(t), "lifecycle.json");
      assert.equal(boundary(record, "journey-alpha.json", "planning", "2026-11-10T09:30:00Z", qualification).status, 0);
      return JSON.parse(readFileSync(record, "utf8")).stage_boundaries[0].orchestrator;
    };
    const without = counters([]);
    for (const k of keys) assertUnavailable(without[k], `no record ${k}`);
    const qualified = counters(qual("claude-code", "qualification-claude-code.json"));
    assert.deepEqual(keys.map((k) => num(qualified[k], `record ${k}`)), [2, 12, 24, 36, 48]);
  });

  it("records nothing for a journey without the profiler flag", (t) => {
    const record = path.join(tempRoot(t), "lifecycle.json");
    assert.equal(boundary(record, "journey-off.json", "planning", "2026-11-10T09:30:00Z").status, 0);
    assert.equal(existsSync(record), false);
  });
});

describe("journey profiler: staged sanitized export (B30-112, B30-123, SM01.T6, SM01.X5)", () => {
  function collect(value, keys, strings) {
    if (Array.isArray(value)) value.forEach((v) => collect(v, keys, strings));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) { keys.add(k); collect(v, keys, strings); }
    } else if (typeof value === "string") strings.add(value);
  }

  it("stages role-only, deterministic bytes with a matching digest and no routing or private identifiers", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...ALL_HOSTS]);
    const exportOnce = () => {
      const out = path.join(tempRoot(t), "export");
      const r = run(["export", "--profile", path.join(p.out, "profile.json"), "--out", out]);
      assert.equal(r.status, 0, r.stderr);
      const bytes = readFileSync(path.join(out, "export.json"));
      assert.equal(JSON.parse(r.stdout).sha256, sha256(bytes), "printed digest must match the staged bytes");
      return bytes.toString("utf8");
    };
    const first = exportOnce();
    assert.equal(exportOnce(), first, "same profile must stage the same bytes");

    const keys = new Set();
    const strings = new Set();
    collect(JSON.parse(first), keys, strings);
    for (const key of ["model", "harness", "host_session_id", "session", "cwd", "branch", "checkout"]) {
      assert.equal(keys.has(key), false, `export carries private key ${key}`);
    }
    for (const name of ["model-a", "model-b", "model-c", "model-x", "model-o", "claude-code", "codex", ...UNQUALIFIED]) {
      assert.equal(strings.has(name), false, `export names model or harness ${name}`);
    }
    assert.ok(strings.has("reviewer"), "participation is identified by role");
    assertNoLeak({ "export.json": first }, [...CANARIES, ...INTERNAL, "claude"], "export");
    assert.equal(readFileSync(path.join(p.out, "profile.json"), "utf8"), p.bytes, "export must not change the private profile");
  });

  it("rejects a role, stage, or coverage reason outside the public codes", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const base = JSON.parse(p.bytes);
    const cases = [
      ["role", "private-route", (doc) => { doc.usage.find((row) => row.role === "reviewer").role = "private-route"; }],
      ["stage", "secret-stage", (doc) => { doc.usage.find((row) => row.role === "reviewer").stage = "secret-stage"; }],
      ["reason", "threshold-0.9", (doc) => { doc.owner_ask_rate.reason = "threshold-0.9"; }],
    ];
    for (const [name, token, mutate] of cases) {
      const doc = structuredClone(base);
      mutate(doc);
      const dir = path.join(tempRoot(t), name);
      mkdirSync(dir);
      const profilePath = path.join(dir, "profile.json");
      writeFileSync(profilePath, JSON.stringify(doc));
      const out = path.join(dir, "out");
      const result = run(["export", "--profile", profilePath, "--out", out]);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /unsafe_projection/, name);
      assert.equal(existsSync(path.join(out, "export.json")), false, name);
      assert.equal(`${result.stdout}${result.stderr}`.includes(token), false, name);
    }
  });

  it("uses the same export-local alias for a journey and its participation", (t) => {
    const p = profile(t, [...BASE_INPUTS, ...CLAUDE]);
    const out = path.join(tempRoot(t), "export");
    const result = run(["export", "--profile", path.join(p.out, "profile.json"), "--out", out]);
    assert.equal(result.status, 0, result.stderr);
    const bytes = readFileSync(path.join(out, "export.json"), "utf8");
    const staged = JSON.parse(bytes);
    const aliases = new Set(staged.journeys.map((row) => row.journey));
    assert.equal(aliases.size, 2);
    assert.ok(aliases.has(staged.participation.find((row) => row.role === "reviewer").journey));
    assertNoLeak({ export: bytes }, ["jrn-alpha", "jrn-beta"], "public journey aliases");
  });
});

/**
 * Journey profiler export mode (Bearing 3.0 S05T, test-first for S05).
 * Drives tools/journey-profiler.mjs only through its command line
 * (`profile`, then `export --profile <profile.json> --out <dir>`; interface in
 * test/fixtures/journey-profiler/README.md) over synthetic fixtures and
 * synthetic canaries. Oracles: B30-103, B30-112, B30-123, B30-127, B30-505,
 * B30-508; boundary contract F03 (data_contract, failure_recovery, V-F03),
 * F16 (role-only public counts) and TB02 negative_check: staged output names
 * the role only, never a model, harness, private route, path, session or key.
 * SEIT: SEIT-F03, SEIT-TB02-N, SEIT-B30-112, SEIT-B30-123.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "tools", "journey-profiler.mjs");
const FX = path.join(ROOT, "test", "fixtures", "journey-profiler");
const fx = (name) => path.join(FX, name);
const AS_OF = "2026-11-10T13:00:00Z";
const INPUTS = [
  "--journey", fx("journey-alpha.json"), "--journey", fx("journey-beta.json"),
  "--events", fx("events.jsonl"), "--receipt", fx("receipt-reviewer.json"),
  "--host-log", `claude-code=${fx("claude-code.jsonl")}`, "--host-log", `codex=${fx("codex.jsonl")}`,
];
// Synthetic private Fellow route identity (F16); never a real route value.
const FELLOW_MODEL = "model-fellow-CANARY-b30123";
const FELLOW_HARNESS = "harness-fellow-CANARY-b30123";
// F03 public_fields: opaque alias, role/stage, qualified metrics or unavailable, coverage codes.
const PUBLIC_TOP = new Set(["participation", "journeys", "cohort", "owner_ask_rate"]);
const PRIVATE_KEYS = ["model", "harness", "host", "hosts", "session", "host_session_id", "cwd", "branch",
  "checkout", "path", "route", "routes", "tier", "capability_tier", "capability_tiers", "inputs", "diagnostics", "sha256"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function tempRoot(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "journey-export-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Private profile from the real `profile` command, as parsed JSON. */
function privateProfile(t) {
  const out = path.join(tempRoot(t), "profile");
  const r = run(["profile", ...INPUTS, "--as-of", AS_OF, "--out", out]);
  assert.equal(r.status, 0, `profile failed: ${r.error ?? ""}${r.stderr}`);
  return JSON.parse(readFileSync(path.join(out, "profile.json"), "utf8"));
}

/** Adds a bound Fellow participation row carrying a private route identity. */
function withFellow(doc) {
  const reviewer = doc.usage.find((row) => row.role === "reviewer");
  assert.ok(reviewer, "fixture profile must carry the bound reviewer row");
  doc.usage.push({ ...structuredClone(reviewer), role: "fellow", stage: "planning", model: FELLOW_MODEL, harness: FELLOW_HARNESS });
  return doc;
}

/** Writes a private profile and runs export into a fresh owned directory. */
function exportDoc(t, doc) {
  const dir = tempRoot(t);
  const profilePath = path.join(dir, "profile.json");
  const profileBytes = `${JSON.stringify(doc)}\n`;
  writeFileSync(profilePath, profileBytes);
  const out = path.join(dir, "staged");
  const result = run(["export", "--profile", profilePath, "--out", out]);
  const stagedPath = path.join(out, "export.json");
  const staged = existsSync(stagedPath) ? readFileSync(stagedPath, "utf8") : null;
  return { dir, out, result, staged, profilePath, profileBytes };
}

function collect(value, keys, strings) {
  if (Array.isArray(value)) value.forEach((v) => collect(v, keys, strings));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { keys.add(k); collect(v, keys, strings); }
  } else if (typeof value === "string") strings.add(value);
}

/** TB02 forbidden list: every model id and harness name the private source carries. */
function forbiddenTerms(doc) {
  const terms = new Set(Object.keys(doc.hosts ?? {}));
  for (const row of doc.usage) {
    if (typeof row.model === "string") terms.add(row.model);
    if (typeof row.harness === "string") terms.add(row.harness);
  }
  return [...terms];
}

function assertRoleOnly(text, doc, where) {
  const keys = new Set();
  const strings = new Set();
  const staged = JSON.parse(text);
  collect(staged, keys, strings);
  for (const key of Object.keys(staged)) assert.ok(PUBLIC_TOP.has(key), `${where}: non-allowlisted top-level field ${key}`);
  for (const key of PRIVATE_KEYS) assert.equal(keys.has(key), false, `${where}: carries private field ${key}`);
  for (const term of forbiddenTerms(doc)) assert.equal(text.includes(term), false, `${where}: names model or harness ${term}`);
  for (const row of staged.participation) {
    assert.deepEqual(Object.keys(row).sort(), ["attribution", "journey", "role", "stage"], `${where}: participation row ${JSON.stringify(row)}`);
    assert.equal(typeof row.role, "string", `${where}: participation must name a role`);
  }
  return staged;
}

function assertNoStage(t, res, token, name) {
  assert.notEqual(res.result.status, 0, `${name}: unsafe projection must not exit 0`);
  assert.equal(res.staged, null, `${name}: no export.json may be staged`);
  for (const file of readdirSync(res.dir, { recursive: true })) {
    assert.equal(String(file).endsWith(".tmp"), false, `${name}: left partial staged file ${file}`);
  }
  assert.equal(`${res.result.stdout}${res.result.stderr}`.includes(token), false, `${name}: diagnostics echo ${token}`);
  assert.equal(readFileSync(res.profilePath, "utf8"), res.profileBytes, `${name}: private source must be retained unchanged`);
}

describe("journey profiler export: Fellow participation is role only (B30-123, B30-127, F16, TB02)", () => {
  it("stages a Fellow participation row by role and stage without its private model or harness", (t) => {
    const doc = withFellow(privateProfile(t));
    const res = exportDoc(t, doc);
    assert.equal(res.result.status, 0, res.result.stderr);
    const staged = assertRoleOnly(res.staged, doc, "fellow export");
    const fellow = staged.participation.filter((row) => row.role === "fellow");
    assert.equal(fellow.length, 1, "the Fellow participation is counted once by role");
    assert.equal(fellow[0].stage, "planning");
    assert.ok(staged.participation.some((row) => row.role === "reviewer"), "other roles keep their participation");
    for (const text of [res.staged, res.result.stdout, res.result.stderr]) {
      assert.equal(text.includes("CANARY-b30123"), false, "Fellow route identity must stay private");
    }
  });

  it("gives Fellow and reviewer participation of one journey the same export-local alias", (t) => {
    const doc = withFellow(privateProfile(t));
    const res = exportDoc(t, doc);
    assert.equal(res.result.status, 0, res.result.stderr);
    const staged = JSON.parse(res.staged);
    const byRole = (role) => staged.participation.find((row) => row.role === role).journey;
    assert.equal(byRole("fellow"), byRole("reviewer"));
    assert.ok(staged.journeys.some((row) => row.journey === byRole("fellow")), "alias resolves to a staged journey");
    assert.equal(res.staged.includes("jrn-alpha"), false, "private journey id must not be published");
  });
});

describe("journey profiler export: negative crossings of F03 and TB02 on fresh state (SEIT-F03, SEIT-TB02-N)", () => {
  const ROLE_OR_STAGE = [
    ["role names a model id", (doc) => { doc.usage.find((r) => r.role === "reviewer").role = "model-a"; }, "model-a"],
    ["role names a harness", (doc) => { doc.usage.find((r) => r.role === "reviewer").role = "claude-code"; }, "claude-code"],
    ["role names the Fellow model", (doc) => { withFellow(doc).usage.at(-1).role = FELLOW_MODEL; }, FELLOW_MODEL],
    ["role is a private route cell", (doc) => { doc.usage.find((r) => r.role === "reviewer").role = "fellow:harness-fellow-CANARY-b30123"; }, FELLOW_HARNESS],
    ["role is a tier label", (doc) => { doc.usage.find((r) => r.role === "reviewer").role = "tier-frontier-CANARY"; }, "tier-frontier-CANARY"],
    ["stage is a checkout path", (doc) => { doc.usage.find((r) => r.role === "reviewer").stage = "/work/CANARY-path"; }, "/work/CANARY-path"],
    ["stage is a host session id", (doc) => { doc.usage.find((r) => r.role === "reviewer").stage = "sess-CANARY-1"; }, "sess-CANARY-1"],
    ["coverage reason is a key", (doc) => { doc.owner_ask_rate = { value: "unavailable", reason: "sk_CANARY_key" }; }, "sk_CANARY_key"],
  ];
  for (const [name, mutate, token] of ROLE_OR_STAGE) {
    it(`rejects a projected value outside the public codes: ${name}`, (t) => {
      const doc = privateProfile(t);
      mutate(doc);
      const res = exportDoc(t, doc);
      assertNoStage(t, res, token, name);
      assert.match(res.result.stderr, /unsafe_projection|invalid/, name);
    });
  }

  const EXTRA_FIELDS = [
    ["usage row route field", (doc) => { doc.usage[0].route = "route-CANARY-private"; }, "route-CANARY-private"],
    ["usage row tier field", (doc) => { doc.usage[0].capability_tier = "tier-CANARY"; }, "tier-CANARY"],
    ["usage row session field", (doc) => { doc.usage[0].host_session_id = "sess-CANARY-2"; }, "sess-CANARY-2"],
    ["journey metric path field", (doc) => { doc.journeys[0].metrics.checkout = "/work/CANARY-checkout"; }, "/work/CANARY-checkout"],
    ["top-level key field", (doc) => { doc.api_key = "sk-CANARY-top"; }, "sk-CANARY-top"],
  ];
  for (const [name, mutate, token] of EXTRA_FIELDS) {
    it(`never publishes a non-allowlisted private field: ${name}`, (t) => {
      const doc = privateProfile(t);
      mutate(doc);
      const res = exportDoc(t, doc);
      // Allowlist projection: either the invalid profile is refused, or the field is not projected.
      if (res.result.status !== 0) assertNoStage(t, res, token, name);
      else {
        assert.equal(res.staged.includes(token), false, `${name}: staged ${token}`);
        assert.equal(res.result.stdout.includes(token), false, `${name}: printed ${token}`);
        assertRoleOnly(res.staged, doc, name);
      }
    });
  }

  it("replaces private journey identifiers that look like paths or sessions with opaque aliases", (t) => {
    const doc = privateProfile(t);
    const rename = new Map([["jrn-alpha", "/work/CANARY-alpha"], ["jrn-beta", "sess-CANARY-beta"]]);
    for (const row of [...doc.usage, ...doc.journeys]) if (rename.has(row.journey)) row.journey = rename.get(row.journey);
    const res = exportDoc(t, doc);
    assert.equal(res.result.status, 0, res.result.stderr);
    assert.equal(res.staged.includes("CANARY"), false, "journey ids are aliased, not published");
    assertRoleOnly(res.staged, doc, "aliased journeys");
  });
});

describe("journey profiler export: exact bytes for owner approval, no publication (B30-112, B30-505, B30-508, SM01)", () => {
  it("binds the printed digest to the exact staged bytes, which change when the content changes", (t) => {
    const doc = withFellow(privateProfile(t));
    const first = exportDoc(t, doc);
    const again = exportDoc(t, structuredClone(doc));
    assert.equal(first.result.status, 0, first.result.stderr);
    assert.equal(JSON.parse(first.result.stdout).sha256, sha256(first.staged), "digest is of the staged bytes");
    assert.equal(again.staged, first.staged, "same private profile stages identical bytes");

    const changed = structuredClone(doc);
    changed.journeys[0].metrics.elapsed_time = { value: 1 };
    const altered = exportDoc(t, changed);
    assert.equal(altered.result.status, 0, altered.result.stderr);
    assert.notEqual(JSON.parse(altered.result.stdout).sha256, JSON.parse(first.result.stdout).sha256,
      "an approval of the earlier digest cannot cover changed bytes");
  });

  it("stages only export.json in the named local directory and publishes nothing", (t) => {
    const doc = privateProfile(t);
    const res = exportDoc(t, doc);
    assert.equal(res.result.status, 0, res.result.stderr);
    assert.deepEqual(readdirSync(res.out), ["export.json"], "only the staged candidate is written");
    assert.deepEqual(readdirSync(res.dir).sort(), ["profile.json", "staged"], "nothing written beside the owned paths");
    assert.deepEqual(Object.keys(JSON.parse(res.result.stdout)), ["sha256"], "stdout carries only the digest, no destination or push record");
    assert.equal(readFileSync(res.profilePath, "utf8"), res.profileBytes, "private profile is retained unchanged");
  });

  it("leaves no candidate when the private profile is not a valid profile", (t) => {
    const dir = tempRoot(t);
    const profilePath = path.join(dir, "profile.json");
    writeFileSync(profilePath, "{\"usage\": [}\n");
    const out = path.join(dir, "staged");
    mkdirSync(out);
    const result = run(["export", "--profile", profilePath, "--out", out]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(readdirSync(out), [], "no staged output after a failed projection");
  });
});

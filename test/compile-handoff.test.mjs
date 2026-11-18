/**
 * Deterministic handoff compiler (Bearing 3.0 S08T, test-first for S08).
 * Drives tools/compile-handoff.mjs only through its command line over copies of
 * the synthetic frozen inputs in test/fixtures/compile-handoff (interface: that
 * README). Oracles: B30-244, B30-303/304, B30-306..311, B30-326/327, B30-409,
 * B30-503..505, B30-523; boundary contract F04, SM05 (T1-T3, X1-X5), TB03.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "tools", "compile-handoff.mjs");
const SCHEMA = path.join(ROOT, "schemas", "handoff.schema.json");
const FX = path.join(ROOT, "test", "fixtures", "compile-handoff");
const TITLES = ["ROLE / SESSION", "STATE / INPUTS", "OBJECTIVE / ACCEPTANCE", "AUTHORITY", "LOOP", "VERIFY", "RETURN / STOP"];
const CANDIDATE = "fixture-candidate-0123abcd";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

/** Fresh copy of the frozen inputs per test (SEIT: unique temp root, removed on exit). */
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "compile-handoff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FX, path.join(root, "in"), { recursive: true });
  const dir = path.join(root, "in");
  return {
    root,
    dir,
    plan: path.join(dir, "package"),
    implementation: path.join(dir, "package", "implementation.json"),
    seit: path.join(dir, "package", "seit.json"),
    authority: path.join(dir, "authority.json"),
    binding: path.join(dir, "binding.json"),
  };
}

/** Every input file -> sha256, for before/after immutability checks. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = sha256(readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

function args(f, slice, over = {}) {
  const a = {
    "--plan": f.plan,
    "--slice": slice,
    "--candidate": CANDIDATE,
    "--authority": f.authority,
    "--authority-sha256": sha256(readFileSync(f.authority)),
    "--binding": f.binding,
    "--binding-sha256": sha256(readFileSync(f.binding)),
    "--implementation-sha256": sha256(readFileSync(f.implementation)),
    "--seit-sha256": sha256(readFileSync(f.seit)),
    ...over,
  };
  return Object.entries(a).flatMap(([k, v]) => (v === undefined ? [] : [k, v]));
}

/**
 * Runs the compiler read-only: Node's permission model allows reads only, so any
 * file write or child process (launch) attempt fails the run (SM05.T3, TB03).
 */
function compile(f, slice, over = {}, env = {}) {
  const r = spawnSync(process.execPath, ["--permission", "--allow-fs-read=*", CLI, ...args(f, slice, over)], {
    cwd: f.root,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", json };
}

function ready(f, slice = "S1", over = {}, env = {}) {
  const r = compile(f, slice, over, env);
  assert.equal(r.status, 0, `compile ${slice} exit ${r.status}: ${r.stderr.slice(-800)}`);
  assert.equal(r.json?.outcome, "PACKET_READY", r.stdout.slice(0, 800));
  return r;
}

/** Asserts a typed compilation gap naming `field`, with no usable packet and unchanged inputs. */
function assertGap(f, slice, field, over = {}) {
  const before = snapshot(f.dir);
  const r = compile(f, slice, over);
  assert.equal(r.status, 1, `expected gap exit 1 for ${field}, got ${r.status}: ${r.stdout.slice(0, 400)} ${r.stderr.slice(-400)}`);
  assert.equal(r.json?.outcome, "COMPILATION_GAP", r.stdout.slice(0, 400));
  assert.ok(Array.isArray(r.json.gaps) && r.json.gaps.some((g) => g.field === field), `gap names ${field}: ${JSON.stringify(r.json.gaps)}`);
  for (const k of ["text", "sections", "write_set", "route"]) assert.equal(r.json[k], undefined, `gap carries no usable ${k}`);
  assert.deepEqual(snapshot(f.dir), before, "inputs unchanged");
  return r;
}

function mutate(file, fn) {
  const v = readJson(file);
  fn(v);
  writeJson(file, v);
}
const slice = (impl, id) => impl.slices.find((s) => s.id === id);
const commonPrefix = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

describe("positive path (F04, SM05.T1-T2, B30-306)", () => {
  it("compiles the same frozen assignment twice to byte-identical packets without touching inputs", (t) => {
    const f = fixture(t);
    const before = snapshot(f.dir);
    const a = ready(f);
    const b = ready(f);
    assert.equal(a.stdout, b.stdout);
    assert.deepEqual(snapshot(f.dir), before);
    assert.deepEqual(readdirSync(f.root).sort(), ["in"], "nothing written beside the inputs");
  });

  it("binds every frozen input identity into the packet", (t) => {
    const f = fixture(t);
    const { json } = ready(f);
    assert.deepEqual(
      {
        slice: json.identity.slice,
        wave: json.identity.wave,
        role: json.identity.role,
        candidate_revision: json.identity.candidate_revision,
        authority_id: json.identity.authority_id,
        authority_sha256: json.identity.authority_sha256,
        binding_sha256: json.identity.binding_sha256,
        implementation_sha256: json.identity.implementation_sha256,
        seit_sha256: json.identity.seit_sha256,
      },
      {
        slice: "S1",
        wave: "W1",
        role: "Implementer",
        candidate_revision: CANDIDATE,
        authority_id: "AUTH-FX",
        authority_sha256: sha256(readFileSync(f.authority)),
        binding_sha256: sha256(readFileSync(f.binding)),
        implementation_sha256: sha256(readFileSync(f.implementation)),
        seit_sha256: sha256(readFileSync(f.seit)),
      },
    );
  });

  it("carries the seven Prompt sections in template order (B30-304, B30-308)", (t) => {
    const f = fixture(t);
    const { json } = ready(f);
    assert.deepEqual(json.sections.map((s) => s.title), TITLES);
    let at = -1;
    for (const title of TITLES) {
      const i = json.text.indexOf(title, at + 1);
      assert.ok(i > at, `${title} appears after the previous section`);
      at = i;
    }
  });

  it("projects the frozen route, fallback order and capabilities unchanged (B30-504, TB03)", (t) => {
    const f = fixture(t);
    const binding = readJson(f.binding);
    const { json } = ready(f);
    assert.deepEqual(json.route, binding.snapshot.roles.implementer);
    assert.deepEqual(json.capabilities, {
      review: binding.snapshot.review,
      deterministic_verification: binding.snapshot.deterministic_verification,
    });
    assert.ok(!json.text.includes("fixture-model-fellow"), "a frozen fellow route is not selected for the assignee (B30-117)");
  });

  it("names the canonical role skill and owner-only actions (B30-308, B30-505)", (t) => {
    const f = fixture(t);
    const { json } = ready(f);
    assert.ok(json.text.includes("skills/implementer/SKILL.md"));
    for (const action of readJson(f.authority).prohibited.actions) assert.ok(json.text.includes(action), `owner-only ${action}`);
  });

  it("keeps required gates mandatory in VERIFY and traces acceptance to evidence (B30-308, B30-309)", (t) => {
    const f = fixture(t);
    const { json } = ready(f);
    assert.deepEqual(json.commands, [{ id: "CMD-FX-UNIT", command: "node --test test/fx-unit.test.mjs" }]);
    assert.deepEqual(json.acceptance, [
      { id: "SEIT-FX-1", pass_fail_rule: "PASS-FX-1: three input lines yield three records.", observable_evidence: "EVIDENCE-FX-1: record count in TAP output" },
    ]);
    const verify = json.sections.find((s) => s.title === "VERIFY").body;
    assert.ok(verify.includes("node --test test/fx-unit.test.mjs"), "repository gate named in VERIFY");
    for (const s of ["SEIT-FX-1", "PASS-FX-1", "EVIDENCE-FX-1"]) assert.ok(json.text.includes(s), `acceptance trace ${s}`);
  });

  it("emits a minimal packet: no other slice and no raw planning history (B30-306, B30-308)", (t) => {
    const f = fixture(t);
    const { stdout } = ready(f);
    for (const s of ["GOAL-S2", "src/formatter.mjs", "SEIT-FX-2", "CANARY-RAW-HISTORY-b30308"]) assert.ok(!stdout.includes(s), `packet omits ${s}`);
  });

  it("starts no process when consumed (SM05.T3): launcher stubs on PATH stay untouched", (t) => {
    const f = fixture(t);
    const bin = path.join(f.root, "bin");
    mkdirSync(bin);
    const marker = path.join(f.root, "launched");
    for (const name of ["claude", "codex", "cursor-agent", "agy", "muse", "omp", "git", "sh", "bash"]) {
      writeFileSync(path.join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`);
      chmodSync(path.join(bin, name), 0o755);
    }
    ready(f, "S1", {}, { PATH: bin });
    assert.equal(existsSync(marker), false);
  });
});

describe("stable sections first (SEIT-B30-311)", () => {
  it("two slices of one wave and role share a byte prefix covering every stable section", (t) => {
    const f = fixture(t);
    const s1 = ready(f, "S1").json.text;
    const s2 = ready(f, "S2").json.text;
    const p = commonPrefix(s1, s2);
    for (const stable of ["ROLE / SESSION", "skills/implementer/SKILL.md", "fixture-model-impl", "fixture-model-fb-b", "AUTH-FX", "OWNER-ONLY-publish-release"]) {
      const i = s1.indexOf(stable);
      assert.ok(i >= 0 && i < p, `stable ${stable} inside shared prefix (${i} < ${p})`);
    }
    for (const specific of ["GOAL-S1", "demo: src/parser.mjs", "SEIT-FX-1"]) {
      assert.ok(s1.indexOf(specific) >= p, `slice-specific ${specific} after shared prefix`);
    }
  });
});

describe("write-set preservation (SEIT-B30-326, SM05.X4, TB03, B30-503, B30-523)", () => {
  it("output limit equals the recorded write set; outside expected files are flagged guidance only", (t) => {
    const f = fixture(t);
    const before = snapshot(f.dir);
    const recorded = slice(readJson(f.implementation), "S1").write_set;
    const { json } = ready(f);
    assert.deepEqual(json.write_set, recorded);
    assert.deepEqual(json.expected_files, [
      { path: "demo: src/parser.mjs", inside_write_set: true },
      { path: "demo: test/fixtures/parser/one-line.txt", inside_write_set: true },
      { path: "demo: test/fixtures/parser-evil/escape.txt", inside_write_set: false },
      { path: "demo: test/fixtures/parser/../../../outside/escape.txt", inside_write_set: false },
      { path: "demo: outside/escape.txt", inside_write_set: false },
      { path: "other-repo: src/parser.mjs", inside_write_set: false },
    ]);
    assert.deepEqual(snapshot(f.dir), before, "source and binding hashes unchanged");
  });

  it("an outside expected file yields a stop-and-return obligation, never a wider AUTHORITY limit", (t) => {
    const f = fixture(t);
    const { json } = ready(f);
    const authority = json.sections.find((s) => s.title === "AUTHORITY").body;
    for (const p of recordedPaths(f)) assert.ok(authority.includes(p), `AUTHORITY names recorded ${p}`);
    assert.match(json.text, /Orchestrator/);
    assert.match(json.text, /outside (?:the |its )?(?:recorded )?write[- ]set|out-of-set/i);
    assert.match(json.text, /\bstop\b/i);
    assert.match(json.text, /\breturn\b/i);
  });

  it("write-set entries never come from authority.allowed.paths or expected files", (t) => {
    const f = fixture(t);
    mutate(f.implementation, (impl) => {
      slice(impl, "S1").expected_files = ["demo: src/", "demo: test/"];
    });
    const { json } = ready(f);
    assert.deepEqual(json.write_set, ["demo: src/parser.mjs", "demo: test/fixtures/parser/"]);
    assert.ok(json.expected_files.every((e) => e.inside_write_set === false));
  });
});

function recordedPaths(f) {
  return slice(readJson(f.implementation), "S1").write_set;
}

describe("required fields (SEIT-B30-327, SM05.X5, B30-409)", () => {
  const variants = [
    ["objective", (s) => delete s.goal, (s) => (s.goal = "")],
    ["acceptance", (s) => delete s.seit_proof_rows, (s) => (s.seit_proof_rows = [])],
    ["write_set", (s) => delete s.write_set, (s) => (s.write_set = [])],
    ["commands", (s) => delete s.command_ids, (s) => (s.command_ids = [])],
  ];
  for (const [field, missing, empty] of variants) {
    for (const [kind, fn] of [["missing", missing], ["empty", empty]]) {
      it(`${kind} ${field} is a compilation gap naming ${field}`, (t) => {
        const f = fixture(t);
        mutate(f.implementation, (impl) => fn(slice(impl, "S1")));
        assertGap(f, "S1", field);
      });
    }
  }
  for (const [kind, fn] of [["missing", (c) => delete c.observable_evidence], ["empty", (c) => (c.observable_evidence = "")]]) {
    it(`${kind} named evidence is a compilation gap naming evidence`, (t) => {
      const f = fixture(t);
      mutate(f.seit, (seit) => fn(seit.proof_cases.find((c) => c.id === "SEIT-FX-1")));
      assertGap(f, "S1", "evidence");
    });
  }
  it("a command id that names no existing command is a gap, not an invented command", (t) => {
    const f = fixture(t);
    mutate(f.implementation, (impl) => (slice(impl, "S1").command_ids = ["CMD-FX-NOPE"]));
    assertGap(f, "S1", "commands");
  });
  it("a proof row that resolves to no proof case is an acceptance gap", (t) => {
    const f = fixture(t);
    mutate(f.implementation, (impl) => (slice(impl, "S1").seit_proof_rows = ["SEIT-FX-NOPE"]));
    assertGap(f, "S1", "acceptance");
  });
});

describe("frozen identity and authority (SM05.X1, SM05.X2, F04 failure_recovery)", () => {
  it("refuses a command change after the SEIT was pinned", (t) => {
    const f = fixture(t);
    const frozen = sha256(readFileSync(f.seit));
    mutate(f.seit, (seit) => { seit.procedures_and_commands[0].command = "echo changed-fixture"; });
    assertGap(f, "S1", "seit", { "--seit-sha256": frozen });
  });

  it("refuses an independently pinned record with the wrong shape", (t) => {
    const f = fixture(t);
    writeJson(f.authority, null);
    assertGap(f, "S1", "authority");
  });

  it("does not compile a disabled frozen route", (t) => {
    const f = fixture(t);
    mutate(f.binding, (b) => { b.snapshot.roles.implementer.enabled = false; });
    assertGap(f, "S1", "route");
  });

  it("refuses private fields outside the frozen route and capability contract", (t) => {
    const f = fixture(t);
    mutate(f.binding, (b) => { b.snapshot.roles.implementer.primary.detail = "fixture-private-note"; });
    assertGap(f, "S1", "route");
    mutate(f.binding, (b) => {
      delete b.snapshot.roles.implementer.primary.detail;
      b.snapshot.review.coverage_assist.detail = "fixture-private-note";
    });
    assertGap(f, "S1", "binding");
  });

  it("a Test Implementer uses its frozen route and the canonical Implementer skill", (t) => {
    const f = fixture(t);
    mutate(f.implementation, (impl) => { slice(impl, "S1").role = "Test Implementer"; });
    const { json } = ready(f);
    assert.match(json.sections[0].body, /skills\/implementer\/SKILL\.md/);
    assert.deepEqual(json.route, readJson(f.binding).snapshot.roles.test_implementer);
  });

  it("authority digest mismatch is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "authority", { "--authority-sha256": "0".repeat(64) });
  });
  it("binding digest mismatch is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "binding", { "--binding-sha256": "0".repeat(64) });
  });
  it("implementation digest mismatch is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "implementation", { "--implementation-sha256": "0".repeat(64) });
  });
  it("an input edited after its digest was recorded is a gap", (t) => {
    const f = fixture(t);
    const frozen = sha256(readFileSync(f.authority));
    mutate(f.authority, (a) => a.allowed.paths.push("demo: /"));
    assertGap(f, "S1", "authority", { "--authority-sha256": frozen });
  });
  it("missing authority input is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "authority", { "--authority": path.join(f.dir, "absent.json") });
  });
  it("missing binding input is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "binding", { "--binding": path.join(f.dir, "absent.json") });
  });
  it("missing candidate revision is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S1", "candidate", { "--candidate": undefined });
  });
  it("unknown slice is a gap", (t) => {
    const f = fixture(t);
    assertGap(f, "S9", "slice");
  });
  it("conflicting authority id is a gap, not a substituted envelope", (t) => {
    const f = fixture(t);
    mutate(f.implementation, (impl) => (slice(impl, "S1").authority_id = "AUTH-OTHER"));
    assertGap(f, "S1", "authority");
  });
  it("an ineffective authority envelope is a gap", (t) => {
    const f = fixture(t);
    mutate(f.authority, (a) => (a.effective = false));
    assertGap(f, "S1", "authority");
  });
  it("a role with no frozen route is a gap, never an invented or live route", (t) => {
    const f = fixture(t);
    mutate(f.binding, (b) => delete b.snapshot.roles.implementer);
    assertGap(f, "S1", "route");
  });
});

describe("handoff schema (SEIT-B30-306, closed schema)", () => {
  const hasJsonschema = spawnSync("python3", ["-c", "import jsonschema"]).status === 0;
  const validate = (file) =>
    spawnSync("python3", ["-I", "-c", "import json,sys,jsonschema;s=json.load(open(sys.argv[1]));jsonschema.Draft202012Validator.check_schema(s);jsonschema.Draft202012Validator(s).validate(json.load(open(sys.argv[2])))", SCHEMA, file], { encoding: "utf8" });
  it("a compiled packet validates; an injected authority field does not", { skip: !hasJsonschema && "python3 jsonschema not installed" }, (t) => {
    const f = fixture(t);
    mutate(f.binding, (b) => {
      for (const fallback of b.snapshot.roles.implementer.ordered_fallbacks) fallback.condition = "verified unavailable";
    });
    const { json } = ready(f);
    assert.match(json.sections[0].body, /verified unavailable/);
    const good = path.join(f.root, "packet.json");
    writeJson(good, json);
    const ok = validate(good);
    assert.equal(ok.status, 0, ok.stderr.slice(-800));
    const bad = path.join(f.root, "packet-extra.json");
    writeJson(bad, { ...json, authority_override: { write_set: ["demo: /"] } });
    assert.notEqual(validate(bad).status, 0, "closed schema refuses a second authority field");
  });
});

describe("Prompt default path retained before promotion (SM05.X3, B30-307)", () => {
  it("skills/prompt/SKILL.md keeps its seven-section packet template", () => {
    const text = readFileSync(path.join(ROOT, "skills", "prompt", "SKILL.md"), "utf8");
    assert.ok(text.includes("## Packet template"));
    for (const title of TITLES) assert.ok(text.includes(`${title}:`), title);
  });
});

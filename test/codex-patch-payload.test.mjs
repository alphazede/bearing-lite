import { withTask } from "./task-opt-in-fixture.mjs";
/**
 * D4 / D4b regression: the real Codex 0.162.1 `apply_patch` PreToolUse payload carries the raw
 * patch body in `tool_input.command` with absolute `*** Add|Update|Delete File:` targets
 * (fixtures/codex-patch-payload/native-apply-patch.json, captured from a native run, workspace
 * replaced by __WORKSPACE__, session/turn/model/transcript metadata removed). Protected-file and Test Engineering routing must read it.
 * D5: a native `*** Update File: <src>` + `*** Move to: <dst>` rename (native-move-patch.json,
 * captured with relative paths, session/model metadata removed) writes <dst>, so the destination
 * must reach the same routing as any other patch target.
 *
 * Write lock: runs the real adapter entry point (`node hooks/orchestrator-write-lock.cjs`, stdin
 * envelope) exactly as Codex invokes it, with BEARING_* cleared and a bound non-owning
 * BEARING_ROLE unless a case names one (an empty role is the Planning Orchestrator controller).
 * TE: runs the real `te-host.cjs` handle() against a workspace whose capability path holds a
 * recording module. The recorder returns no policy; only Lite's request construction is asserted.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "hooks", "orchestrator-write-lock.cjs");
const FIXTURE = path.join(ROOT, "test", "fixtures", "codex-patch-payload", "native-apply-patch.json");
const MOVE_FIXTURE = path.join(ROOT, "test", "fixtures", "codex-patch-payload", "native-move-patch.json");

const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });

function workspace(label) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `bearing-d4-${label}-${process.pid}-`));
  DIRS.push(dir);
  writeFileSync(path.join(dir, "design.md"), "# design\n");
  return dir;
}

/** The captured native envelope bound to `ws`, optionally with a different patch body or tool input. */
function nativeEnvelope(ws, override = {}) {
  const env = JSON.parse(readFileSync(FIXTURE, "utf8").replaceAll("__WORKSPACE__", ws));
  return { ...env, ...override };
}

/** The captured native Move-to envelope bound to `ws`, with the rename source in place. */
function moveEnvelope(ws, command, extra = {}) {
  mkdirSync(path.join(ws, "notes"), { recursive: true });
  writeFileSync(path.join(ws, "notes", "allowed.md"), "allowed\n");
  const env = JSON.parse(readFileSync(MOVE_FIXTURE, "utf8").replaceAll("__WORKSPACE__", ws));
  if (command) env.tool_input = { command, ...extra };
  return env;
}

const patch = (...ops) => ["*** Begin Patch", ...ops, "*** End Patch"].join("\n");

/**
 * design.md is authored by the Planning Orchestrator controller (and Systems Modeler
 * views), so detection cases run as a bound non-owning role unless a case names one.
 */
const NON_OWNER = "coordinator";

function runLock(envelope, role = NON_OWNER) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("BEARING_")) delete env[k];
  if (role) env.BEARING_ROLE = role;
  const r = spawnSync(process.execPath, [LOCK], { input: JSON.stringify(withTask(envelope)), env, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, `write lock exit=${r.status} signal=${r.signal}\nstderr: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const denied = (out) => out.hookSpecificOutput?.permissionDecision === "deny";

describe("Codex apply_patch payload: orchestrator write lock (D4)", () => {
  it("denies the captured native apply_patch Update of design.md by a non-owning role", () => {
    const ws = workspace("native");
    const out = runLock(nativeEnvelope(ws));
    assert.ok(denied(out), `D4: native apply_patch to design.md was not denied: ${JSON.stringify(out)}`);
  });

  for (const [op, body] of [
    ["Add", (ws) => patch(`*** Add File: ${ws}/design.md`, "+# design")],
    ["Delete", (ws) => patch(`*** Delete File: ${ws}/design.md`)],
  ]) {
    it(`denies a native-shape apply_patch ${op} of design.md by a non-owning role`, () => {
      const ws = workspace(op.toLowerCase());
      const out = runLock(nativeEnvelope(ws, { tool_input: { command: body(ws) } }));
      assert.ok(denied(out), `D4: apply_patch ${op} to design.md was not denied: ${JSON.stringify(out)}`);
    });
  }

  // A real apply_patch Add File to an absolute path whose parent directory contains a space was
  // accepted and applied in full by the native tool; the target is the whole rest of the line.
  it("denies a native-shape apply_patch Add of design.md under a directory containing a space", () => {
    const ws = workspace("space");
    const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch(`*** Add File: ${ws}/space dir/design.md`, "+# design") } }));
    assert.ok(denied(out), `D5: apply_patch Add to 'space dir/design.md' was not denied: ${JSON.stringify(out)}`);
  });

  it("allows a native-shape apply_patch Add of a non-protected file under a directory containing a space", () => {
    const ws = workspace("space-allowed");
    const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch(`*** Add File: ${ws}/space dir/notes.md`, "+ok") } }));
    assert.ok(!denied(out), JSON.stringify(out));
  });

  it("allows a native-shape apply_patch to a non-protected file", () => {
    const ws = workspace("notes");
    const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch(`*** Add File: ${ws}/notes/allowed.md`, "+ok") } }));
    assert.ok(!denied(out), JSON.stringify(out));
  });

  it("allows the captured native apply_patch for the owning role", () => {
    const ws = workspace("owner");
    const out = runLock(nativeEnvelope(ws), "systems_modeler");
    assert.ok(!denied(out), JSON.stringify(out));
  });

  it("lets the Planning Orchestrator controller author design.md but not SEIT (F1)", () => {
    const ws = workspace("controller");
    assert.ok(!denied(runLock(nativeEnvelope(ws), "")), "controller final design write must be allowed");
    const command = patch(`*** Update File: ${ws}/seit.json`, "@@", "-{}", "+{}");
    const out = runLock(nativeEnvelope(ws, { tool_input: { command } }), "");
    assert.ok(denied(out), `controller SEIT write must stay denied: ${JSON.stringify(out)}`);
  });

  it("keeps denying the legacy patch and diff fields", () => {
    const ws = workspace("legacy");
    const body = nativeEnvelope(ws).tool_input.command;
    assert.ok(denied(runLock(nativeEnvelope(ws, { tool_input: { patch: body } }))), "legacy tool_input.patch");
    const diff = "--- a/design.md\n+++ b/design.md\n@@\n-# design\n+# changed\n";
    assert.ok(denied(runLock(nativeEnvelope(ws, { tool_input: { diff } }))), "legacy tool_input.diff");
  });

  it("denies the captured native Move of an allowed file onto design.md by a non-owning role (D5)", () => {
    const ws = workspace("move");
    const out = runLock(moveEnvelope(ws));
    assert.ok(denied(out), `D5: native apply_patch Move to design.md was not denied: ${JSON.stringify(out)}`);
  });

  it("allows a native-shape Move between non-protected files", () => {
    const ws = workspace("move-allowed");
    const command = patch("*** Update File: notes/allowed.md", "*** Move to: notes/renamed.md", "@@", "-allowed", "+moved");
    const out = runLock(moveEnvelope(ws, command));
    assert.ok(!denied(out), JSON.stringify(out));
  });

  it("allows the captured native Move onto design.md for the owning role", () => {
    const ws = workspace("move-owner");
    assert.ok(!denied(runLock(moveEnvelope(ws), "systems_modeler")));
  });

  // IR-F1: native apply_patch (codex-cli 0.162.1) trims leading whitespace on hunk headers and
  // applied `  *** Update File: design.md` (repair-wave-evidence/native-parser.txt).
  it("denies an indented-header apply_patch Update of design.md by a non-owning role", () => {
    const ws = workspace("indent-lock");
    const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch("  *** Update File: design.md", "@@", "-# design", "+# d") } }));
    assert.ok(denied(out), `IR-F1: indented apply_patch Update of design.md was not denied: ${JSON.stringify(out)}`);
  });

  // IR-F3: native apply_patch applied each of these edits to notes/*.md only
  // (repair-wave-evidence/native-parser.txt); hunk content is not file metadata.
  for (const [label, lines] of [
    ["context line ' File: design.md'", [" File: design.md", "-x", "+y"]],
    ["removed line '--- design.md'", ["--- design.md", "+y"]],
    ["added line '+File: design.md'", ["-x", "+File: design.md"]],
  ]) {
    it(`does not deny an apply_patch of notes/a.md whose ${label} mentions design.md`, () => {
      const ws = workspace("content");
      const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch("*** Update File: notes/a.md", "@@", ...lines) } }));
      assert.ok(!denied(out), `IR-F3: hunk content treated as a write target: ${JSON.stringify(out)}`);
    });
  }

  // IR-F3 (additional repair): native apply_patch read these space-prefixed lines as Update
  // context and modified only notes/a.md (additional-repair/test-native-probe.json, cases A, C).
  for (const [label, lines] of [
    ["context line ' *** Update File: design.md'", ["-x", "+y", " *** Update File: design.md"]],
    ["context line ' *** Move to: design.md'", [" *** Add File: test/x.test.mjs", " *** Move to: design.md", "+z"]],
  ]) {
    it(`does not deny an apply_patch of notes/a.md whose ${label} is content`, () => {
      const ws = workspace("header-content");
      const out = runLock(nativeEnvelope(ws, { tool_input: { command: patch("*** Update File: notes/a.md", "@@", ...lines) } }));
      assert.ok(!denied(out), `IR-F3: Update context line treated as a write target: ${JSON.stringify(out)}`);
    });
  }

  // Native apply_patch ended the Add hunk and applied this indented header to design.md (probe case D).
  it("still denies an indented design.md header that follows an Add hunk", () => {
    const ws = workspace("indent-after-add");
    const command = patch("*** Add File: notes/b.md", "+b", "  *** Update File: design.md", "@@", "-# design", "+# d");
    assert.ok(denied(runLock(nativeEnvelope(ws, { tool_input: { command } }))), "IR-F3 control: real indented header must stay denied");
  });

  it("still denies a real design.md header next to content that mentions design.md", () => {
    const ws = workspace("content-control");
    const command = patch("*** Update File: notes/a.md", "@@", " File: design.md", "-x", "+y", "*** Update File: design.md", "@@", "-# design", "+# d");
    assert.ok(denied(runLock(nativeEnvelope(ws, { tool_input: { command } }))), "IR-F3 control: design.md header must stay denied");
  });

  it("does not treat shell text that mentions design.md or patch markers as a write", () => {
    const ws = workspace("shell");
    for (const command of ["cat design.md", `grep -n design ${ws}/design.md`, "echo '*** Update File: design.md'"]) {
      const out = runLock(nativeEnvelope(ws, { tool_name: "Bash", tool_input: { command } }));
      assert.ok(!denied(out), `${command}: ${JSON.stringify(out)}`);
    }
  });
});

describe("Codex apply_patch payload: Test Engineering request (D4b)", () => {
  const teHost = require(path.join(ROOT, "hooks", "te-host.cjs"));

  /** Workspace whose capability path holds a recorder; it decides nothing and always allows. */
  function teWorkspace(label) {
    const ws = workspace(`te-${label}`);
    spawnSync("git", ["init", "-q"], { cwd: ws });
    const hooks = path.join(ws, "skills", "test-engineering", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(path.join(hooks, "te-evaluator.cjs"), `"use strict";
const fs = require("node:fs");
const path = require("node:path");
const log = path.join(__dirname, "requests.jsonl");
const rec = (fn) => (request) => { fs.appendFileSync(log, JSON.stringify({ fn, request }) + "\\n"); return { verdict: "ALLOW", reason: "recorder" }; };
module.exports = { evaluateTestWrite: rec("evaluateTestWrite"), evaluateCompletion: rec("evaluateCompletion") };
`);
    return ws;
  }

  function routed(ws, envelope) {
    teHost.handle(envelope, { selected: true });
    const lines = readFileSync(path.join(ws, "skills", "test-engineering", "hooks", "requests.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "te-host must hand exactly one request to the evaluator");
    return JSON.parse(lines[0]);
  }

  it("routes the native apply_patch to evaluateTestWrite with its targets and the raw tool input", () => {
    const ws = teWorkspace("native");
    const command = patch(`*** Add File: ${ws}/test/new.test.mjs`, "+test", `*** Update File: ${ws}/design.md`, "@@", "-# design", "+# x");
    const envelope = nativeEnvelope(ws, { tool_input: { command } });
    const { fn, request } = routed(ws, envelope);
    assert.equal(fn, "evaluateTestWrite");
    assert.equal(request.tool_name, "apply_patch");
    assert.equal(request.tool_input.command, command, "the evaluator must receive the raw patch body");
    assert.deepEqual(request.target_paths, ["design.md", "test/new.test.mjs"], "D4b: target_paths must name the patch targets");
  });

  it("routes a native Move into test code with the destination in an evaluator-read field (D5)", () => {
    const ws = teWorkspace("move");
    const command = patch("*** Update File: notes/allowed.md", "*** Move to: test/moved.test.mjs", "@@", "-allowed", "+moved");
    const { fn, request } = routed(ws, moveEnvelope(ws, command));
    assert.equal(fn, "evaluateTestWrite");
    assert.equal(request.tool_input.command, command, "raw command must be preserved exactly");
    assert.equal(request.tool_input.patch, command, "canonical patch must be preserved exactly");
    assert.ok(request.target_paths.includes("test/moved.test.mjs"), `D5: target_paths ${JSON.stringify(request.target_paths)}`);
    // The real evaluator reads tool_input.{file_path,path,target_file,notebook_path,filePath}, edits[].file_path, patch/input.
    const read = [
      ...["file_path", "path", "target_file", "notebook_path", "filePath"].map((k) => request.tool_input[k]),
      ...(Array.isArray(request.tool_input.edits) ? request.tool_input.edits.map((e) => e && e.file_path) : []),
    ].filter((v) => typeof v === "string").map((v) => path.resolve(ws, v));
    assert.ok(read.includes(path.join(ws, "test", "moved.test.mjs")),
      `D5: Move destination absent from evaluator-read fields: ${JSON.stringify(request.tool_input)}`);
  });

  it("keeps existing edits entries when deriving Move targets", () => {
    const ws = teWorkspace("move-edits");
    const command = patch("*** Update File: notes/allowed.md", "*** Move to: test/moved.test.mjs", "@@", "-allowed", "+moved");
    const prior = { file_path: "src/kept.mjs" };
    const { request } = routed(ws, moveEnvelope(ws, command, { edits: [prior] }));
    assert.ok(Array.isArray(request.tool_input.edits) && request.tool_input.edits.some((e) => e.file_path === prior.file_path),
      `existing edits entry must survive: ${JSON.stringify(request.tool_input.edits)}`);
  });

  // IR-F1: native apply_patch created test/x.test.mjs from an indented Add header
  // (repair-wave-evidence/native-parser.txt), so routing must match the column-0 control.
  it("routes an indented-header Add of test code like the column-0 control, keeping the raw command", () => {
    const cws = teWorkspace("indent-control");
    const control = routed(cws, nativeEnvelope(cws, { tool_input: { command: patch("*** Add File: test/x.test.mjs", "+x") } })).request;
    const ws = teWorkspace("indent");
    const command = patch("  *** Add File: test/x.test.mjs", "+x");
    const { fn, request } = routed(ws, nativeEnvelope(ws, { tool_input: { command } }));
    assert.equal(fn, "evaluateTestWrite");
    assert.equal(request.tool_input.command, command, "raw command must be preserved exactly");
    assert.deepEqual(request.target_paths, control.target_paths, "IR-F1: indented Add target must match the column-0 control");
    assert.match(request.tool_input.patch, /^\*\*\* Add File: test\/x\.test\.mjs$/m,
      `IR-F1: evaluator-read patch must carry the Add header the evaluator recognizes: ${JSON.stringify(request.tool_input.patch)}`);
  });

  // IR-F3 (additional repair): native apply_patch read these lines as Update context of
  // notes/a.md and created/moved nothing else (additional-repair/test-native-probe.json, B, C).
  for (const [label, lines] of [
    ["' *** Add File: test/x.test.mjs'", ["-x", "+y", " *** Update File: design.md", " *** Add File: test/x.test.mjs"]],
    ["' *** Move to: design.md'", [" *** Add File: test/x.test.mjs", " *** Move to: design.md", "+z"]],
  ]) {
    it(`does not turn Update context ${label} into a target or header`, () => {
      const ws = teWorkspace("header-content");
      const command = patch("*** Update File: notes/a.md", "@@", ...lines);
      const { request } = routed(ws, nativeEnvelope(ws, { tool_input: { command } }));
      assert.equal(request.tool_input.command, command, "raw command must be preserved exactly");
      assert.deepEqual(request.target_paths, ["notes/a.md"], "IR-F3: context line became a phantom target");
      assert.doesNotMatch(request.tool_input.patch, /^\*\*\* (?:Add File: test|Update File: design|Move to: )/m,
        `IR-F3: normalization turned content into a header: ${JSON.stringify(request.tool_input.patch)}`);
      assert.ok(!(request.tool_input.edits || []).length, `IR-F3: phantom Move edits: ${JSON.stringify(request.tool_input.edits)}`);
    });
  }

  // Native apply_patch ended the first Add hunk and created test/x.test.mjs (probe case E).
  it("keeps an indented Add header that follows an Add hunk as a target", () => {
    const ws = teWorkspace("indent-after-add");
    const { request } = routed(ws, nativeEnvelope(ws, { tool_input: { command: patch("*** Add File: notes/b.md", "+b", "  *** Add File: test/x.test.mjs", "+t") } }));
    assert.deepEqual(request.target_paths, ["notes/b.md", "test/x.test.mjs"]);
  });

  it("names a space-containing patch target whole in target_paths", () => {
    const ws = teWorkspace("space");
    const { request } = routed(ws, nativeEnvelope(ws, { tool_input: { command: patch(`*** Add File: ${ws}/space dir/a.test.mjs`, "+t") } }));
    assert.deepEqual(request.target_paths, ["space dir/a.test.mjs"]);
  });

  it("keeps file_path targets and adds none for read-only shell", () => {
    const ws = teWorkspace("controls");
    let { request } = routed(ws, nativeEnvelope(ws, { tool_name: "Write", tool_input: { file_path: `${ws}/test/a.test.mjs`, content: "" } }));
    assert.deepEqual(request.target_paths, ["test/a.test.mjs"]);
    rmSync(path.join(ws, "skills", "test-engineering", "hooks", "requests.jsonl"));
    ({ request } = routed(ws, nativeEnvelope(ws, { tool_name: "Bash", tool_input: { command: "cat design.md" } })));
    assert.deepEqual(request.target_paths, []);
  });
});

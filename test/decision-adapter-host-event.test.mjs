// S11T (Bearing 3.0, W3): decision adapter (N07) called inside the already registered
// SessionStart and Stop handlers of host.cjs (DES-F05, DEC-13), no new hook registration.
// Oracle: boundary contract F05 (data_contract, failure_recovery; sha256 568a2121...),
// assembly-strategy V-F05, SEIT-B30-207, SEIT-F05; requirements B30-202, -207..-213, -220..-232,
// -240, -241, -506, -507 (host side; adapter-side behaviour is S10T's).
//
// Public entry points and the host-side contract these tests fix for S11:
//   <plugin>/hooks/com.anthropic.claude-code/host.cjs, run as the host runs it: JSON event on
//   stdin, JSON on stdout, exit 0. <plugin> is an installed-candidate copy of hooks/, schemas/
//   and package.json in an owned temporary root.
//   - Bound task: the existing visible-plan binding (hooks/task-binding.cjs: `- bearing_session:`
//     line plus a `### task_id:` section). The unresolved eligible choice is the task field
//     `- decision_choice: <one-line JSON adapter input>` ({ decision_type, decision_point,
//     evidence_revision, facts, packet?, options }, the decide() input of S10T).
//   - Backend configuration: <plugin>/hooks/decision-backend.json (the shipped file, DEC-22);
//     the key value comes from the environment variable it names.
//   - Budget: the enclosing host budget is the `timeout` (seconds) of the host.cjs entry for the
//     event in <plugin>/hooks/hooks.json. A missing or zero timeout is an unknown budget: skip
//     inference (F05 timing).
//   - No calibration receipt is supplied, so a model answer never becomes advice (B30-228);
//     a rule decision (B30-202) is projected as its meaning id in additionalContext.
// Where the host keeps its private decision record is not asserted; HOME/XDG/TMPDIR point
// into the owned root so any location is owned and removed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = JSON.parse(readFileSync(path.join(ROOT, "test/fixtures/decision-adapter/cases.json"), "utf8"));
const KEY_VAR = "TEST_DECISION_KEY";
const KEY = "TESTKEY-HOST-CANARY-4417";
const PACKET_CANARY = "PACKET-CANARY-5521"; // inside CASES.packet
const FIT_P = 0.9431; // distinctive probabilities: must never reach host output (B30-229)
const ACT_P = 0.8765;
const SESSION = "s11t-session-1";
const HOST_REL = "hooks/com.anthropic.claude-code/host.cjs";

// ---------- local systemone driver (port 0, logs every request with arrival time) ----------
const isFit = (q) => Array.isArray(q.options) && q.options.length === 2 && q.options.includes("yes") && q.options.includes("no");
function answer(body) {
  const fit = body.questions.find(isFit);
  const choice = body.questions.find((q) => !isFit(q));
  const labels = choice.options;
  const rest = Number(((1 - ACT_P) / (labels.length - 1)).toFixed(4));
  return {
    answers: {
      [fit.id]: { yes: FIT_P, no: Number((1 - FIT_P).toFixed(4)) },
      [choice.id]: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? ACT_P : rest])),
    },
  };
}
async function driver(t) {
  const requests = [];
  let handler = (body) => ({ body: answer(body) });
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ at: performance.now(), headers: req.headers, raw });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const out = handler(body) || {};
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(out.status ?? 200, { "content-type": "application/json" }).end(out.text ?? JSON.stringify(out.body ?? {}));
      };
      if (out.delayMs) setTimeout(send, out.delayMs).unref();
      else send();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests, set: (fn) => (handler = fn), body: (i) => JSON.parse(requests[i].raw) };
}
async function closedPort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
}

// ---------- fixtures: installed candidate, bound project, owned env ----------
let seq = 0;
function choice(over = {}) {
  return {
    decision_type: "dispatch_classification",
    decision_point: `dispatch:S11T:implementer:${process.pid}:${++seq}`,
    evidence_revision: "ev-1",
    facts: { role: "implementer", gate_exit_code: 1 },
    packet: CASES.packet,
    options: { ...CASES.options },
    ...over,
  };
}
function setup(t, drv, opts = {}) {
  // An explicit `timeout: undefined` means "no timeout configured"; only an absent key defaults to 15.
  const { config = {}, host = "claude" } = opts;
  const timeout = "timeout" in opts ? opts.timeout : 15;
  const tmp = mkdtempSync(path.join(tmpdir(), "s11t-host-event-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const plugin = path.join(tmp, "plugin");
  for (const rel of ["hooks", "schemas"]) cpSync(path.join(ROOT, rel), path.join(plugin, rel), { recursive: true });
  cpSync(path.join(ROOT, "package.json"), path.join(plugin, "package.json"));
  const cfg = { protocol: "systemone", base_url: drv?.url ?? "http://127.0.0.1:9", model_id: "test-model-1.0", key_variable_name: KEY_VAR, ...config };
  writeFileSync(path.join(plugin, "hooks/decision-backend.json"), JSON.stringify(cfg, null, 2) + "\n");
  // Installed registration budget for host.cjs on SessionStart and Stop.
  const manifestFile = path.join(plugin, "hooks/hooks.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  for (const event of ["SessionStart", "Stop"]) {
    for (const entry of manifest.hooks[event]) {
      for (const hook of entry.hooks) {
        if (!String(hook.command).includes(HOST_REL)) continue;
        if (timeout === undefined) delete hook.timeout;
        else hook.timeout = timeout;
      }
    }
  }
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const project = path.join(tmp, "project");
  mkdirSync(path.join(project, ".git"), { recursive: true }); // bounds the binding walk
  const home = path.join(tmp, "home");
  mkdirSync(home);
  const env = { PATH: process.env.PATH || "", HOME: home, XDG_CONFIG_HOME: path.join(tmp, "xdg"), XDG_STATE_HOME: path.join(tmp, "xdg-state"), XDG_DATA_HOME: path.join(tmp, "xdg-data"), TMPDIR: tmp, LANG: "C.UTF-8" };
  return { tmp, plugin, project, env, host };
}
function writePlan(project, decision) {
  const lines = [
    "# Visible S11T plan",
    "- journey: s11t-host-event",
    `- bearing_session: ${JSON.stringify({ owner_requested: true, session_id: SESSION, task_id: "T1" })}`,
    "",
    "### task_id: T1",
    "- status: IN_PROGRESS",
    "- assigned_role: Implementer",
    "- next_action: implement the slice",
  ];
  if (decision) lines.push(`- decision_choice: ${JSON.stringify(decision)}`);
  writeFileSync(path.join(project, "plan.md"), lines.join("\n") + "\n");
}
function runHost(fx, event, { key = true, extra = {}, deadlineMs = 30000 } = {}) {
  const env = key ? { ...fx.env, [KEY_VAR]: KEY } : fx.env;
  const input = JSON.stringify({ hook_event_name: event, session_id: SESSION, cwd: fx.project, ...extra });
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const manifest = fx.host === "cursor" ? "hooks/com.cursor/hooks.json" : "hooks/hooks.json";
    const hooks = JSON.parse(readFileSync(path.join(fx.plugin, manifest), "utf8")).hooks;
    const key = fx.host === "cursor" ? event[0].toLowerCase() + event.slice(1) : event;
    const registration = (hooks[key] ?? []).flatMap((item) => item.hooks ?? [item])
      .find((item) => item.command.includes(HOST_REL));
    const args = [path.join(fx.plugin, HOST_REL)];
    if (registration?.command.includes("--host=cursor")) args.push("--host=cursor");
    const child = spawn(process.execPath, args, { cwd: fx.project, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`host.cjs exceeded ${deadlineMs} ms; stderr tail ${stderr.slice(-2000)}`));
    }, deadlineMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, started, closed: performance.now(), ms: performance.now() - started });
    });
    child.stdin.end(input);
  });
}
const context = (run) => JSON.parse(run.stdout).hookSpecificOutput?.additionalContext ?? "";
function assertNoLeak(run) {
  for (const [name, text] of [["stdout", run.stdout], ["stderr", run.stderr]]) {
    assert.ok(!text.includes(KEY), `backend key in ${name}`);
    assert.ok(!text.includes(PACKET_CANARY), `packet text echoed in ${name}`);
    assert.ok(!text.includes(String(FIT_P)) && !text.includes(String(ACT_P)), `probability in ${name}`);
    assert.doesNotMatch(text, /probab/i, `probability field in ${name}`);
  }
}
// Baseline: same event and plan with the adapter disabled (no key in the environment).
async function baseline(fx, event, decision) {
  writePlan(fx.project, decision);
  const run = await runHost(fx, event, { key: false });
  assert.equal(run.code, 0);
  return run;
}
function assertAdvisoryOnly(run, base) {
  assert.equal(run.code, 0, "host exit status is never policy");
  const got = JSON.parse(run.stdout);
  const want = JSON.parse(base.stdout);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), "no new decision/continue/stop field (B30-210, B30-507)");
  assert.equal(got.decision, want.decision);
  assert.ok(context(run).includes(context(base)), "existing host output preserved");
}
function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...filesUnder(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}
const MEANINGS = Object.keys(CASES.options);

describe("S11T decision adapter inside registered SessionStart/Stop handlers (F05)", () => {
  for (const event of ["SessionStart", "Stop"]) {
    it(`SEIT-B30-207 ${event}: the bound eligible choice reaches the backend inside the handler, one request, no tool call`, async (t) => {
      const drv = await driver(t);
      const fx = setup(t, drv);
      const decision = choice();
      const base = await baseline(fx, event, decision);
      assert.equal(drv.requests.length, 0, "adapter-disabled baseline makes no backend request");
      const run = await runHost(fx, event);
      assert.equal(drv.requests.length, 1, "exactly one systemone request from the existing handler");
      assert.ok(drv.requests[0].at < run.closed, "request made while the handler ran, not after");
      const body = drv.body(0);
      assert.equal(body.model, "test-model-1.0", "model id from the installed configuration (B30-222)");
      assert.equal(body.state.untrusted.packet, CASES.packet, "dispatch packet sent as written in untrusted state (B30-241, B30-226)");
      assert.equal(drv.requests[0].headers.authorization, `Bearer ${KEY}`, "key read from the configured variable");
      assertAdvisoryOnly(run, base);
      assertNoLeak(run);
      for (const meaning of MEANINGS) assert.ok(!context(run).includes(meaning), `uncalibrated model answer projected as advice: ${meaning} (B30-228)`);
      // Claude/Codex Stop has no field that carries advice without continuing (hooks/cursor-stop.cjs).
      if (event === "Stop") assert.equal(run.stdout, base.stdout, "Stop output unchanged: no new continuation (F05 failure_recovery)");
    });
  }

  it("SEIT-F05 B30-202/B30-232: a rule-decidable choice is decided by rule with no backend call and projected as advice", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv);
    const decision = choice({ facts: { role: "implementer", bug_route_declaration: "bug-triager" } });
    const base = await baseline(fx, "SessionStart", decision);
    const run = await runHost(fx, "SessionStart");
    assert.equal(drv.requests.length, 0, "deterministic hit has zero model calls");
    assertAdvisoryOnly(run, base);
    assert.match(context(run), /repair_bug_route/, "rule meaning delivered as advisory context");
    assertNoLeak(run);
  });

  it("SEIT-F05 B30-213: the same choice at the same state and evidence revision reuses the record across handler runs", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv);
    const decision = choice();
    writePlan(fx.project, decision);
    const first = await runHost(fx, "SessionStart");
    const second = await runHost(fx, "Stop");
    const third = await runHost(fx, "Stop");
    for (const run of [first, second, third]) assert.equal(run.code, 0);
    assert.equal(drv.requests.length, 1, "one inference for one decision point/state/evidence revision");
    writePlan(fx.project, { ...decision, evidence_revision: "ev-2" });
    await runHost(fx, "Stop");
    assert.equal(drv.requests.length, 2, "a new evidence revision is a new decision");
  });

  it("SEIT-F05 B30-212/B30-220: a backend that answers after the budget leaves host output byte-identical and the hook inside its budget", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv, { timeout: 5 });
    drv.set(() => ({ delayMs: 60000, body: {} }));
    const decision = choice();
    const base = await baseline(fx, "Stop", decision);
    const run = await runHost(fx, "Stop");
    assert.equal(drv.requests.length, 1, "the adapter was called (otherwise identity proves nothing)");
    assert.ok(run.ms < 5000, `host finished inside its 5 s registration budget (took ${Math.round(run.ms)} ms)`);
    assert.equal(run.code, 0);
    assert.equal(run.stdout, base.stdout, "no adapter hook output on timeout");
    assertNoLeak(run);
    // A late answer must not become advice for the next run at the same state.
    drv.set((body) => ({ body: answer(body) }));
    const again = await runHost(fx, "Stop");
    assertAdvisoryOnly(again, base);
  });

  it("SEIT-F05 B30-212: backend error, invalid body and refused connection take the silent fallback", async (t) => {
    const drv = await driver(t);
    const cases = [
      ["HTTP 500", () => ({ status: 500, text: "{}" })],
      ["invalid body", () => ({ text: "not json" })],
      ["wrong shape", () => ({ body: { answers: { fit: { yes: 2 } } } })],
    ];
    for (const [label, fn] of cases) {
      const fx = setup(t, drv);
      drv.set(fn);
      const decision = choice();
      const base = await baseline(fx, "Stop", decision);
      const before = drv.requests.length;
      const run = await runHost(fx, "Stop");
      assert.equal(drv.requests.length, before + 1, `${label}: adapter called`);
      assert.equal(run.code, 0, label);
      assert.equal(run.stdout, base.stdout, `${label}: output identical to adapter-disabled`);
      assertNoLeak(run);
    }
    const fx = setup(t, null, { config: { base_url: await closedPort() } });
    const decision = choice();
    const base = await baseline(fx, "Stop", decision);
    const run = await runHost(fx, "Stop");
    assert.equal(run.stdout, base.stdout, "refused connection: output identical to adapter-disabled");
    assertNoLeak(run);
  });

  it("SEIT-F05 negative crossings: no binding, re-entry, unsupported events and ineligible types make no backend call", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv);
    writePlan(fx.project, choice());
    const unbound = await runHost(fx, "SessionStart", { extra: { session_id: "someone-else" } });
    assert.equal(unbound.code, 0);
    assert.deepEqual(JSON.parse(unbound.stdout), {}, "no binding: quiet existing host response");
    const reentry = await runHost(fx, "Stop", { extra: { stop_hook_active: true } });
    assert.deepEqual(JSON.parse(reentry.stdout), {}, "stop re-entry stays quiet");
    for (const event of ["SubagentStop", "SessionEnd", "UserPromptSubmit", "PreToolUse"]) {
      const run = await runHost(fx, event);
      assert.equal(run.code, 0, event);
    }
    assert.equal(drv.requests.length, 0, "only SessionStart and Stop may call the adapter");
    writePlan(fx.project, choice({ decision_type: "assurance" }));
    await runHost(fx, "Stop");
    assert.equal(drv.requests.length, 0, "ineligible decision type never reaches the backend (B30-208)");
    writePlan(fx.project, null);
    const none = await runHost(fx, "Stop");
    assert.equal(none.code, 0);
    assert.equal(drv.requests.length, 0, "no unresolved choice: no inference");
  });

  it("SEIT-F05 timing: an unknown or zero registration budget skips inference", async (t) => {
    const drv = await driver(t);
    for (const timeout of [undefined, 0]) {
      const fx = setup(t, drv, { timeout });
      const decision = choice();
      const base = await baseline(fx, "Stop", decision);
      const run = await runHost(fx, "Stop");
      assert.equal(run.stdout, base.stdout, `timeout=${timeout}: output unchanged`);
    }
    assert.equal(drv.requests.length, 0, "missing usable budget => skip inference");
  });

  it("Cursor SessionStart respects its own registration budget", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv, { host: "cursor" });
    const base = await baseline(fx, "SessionStart", choice());
    const run = await runHost(fx, "SessionStart");
    assert.equal(run.stdout, base.stdout);
    assert.equal(drv.requests.length, 0);
  });

  it("SEIT-F05: a choice line leaves the existing SessionStart and Stop outputs unchanged when the adapter is silent", async (t) => {
    const fx = setup(t, null);
    for (const event of ["SessionStart", "Stop"]) {
      const plain = await baseline(fx, event, null);
      const withChoice = await baseline(fx, event, choice());
      assert.equal(withChoice.stdout, plain.stdout, `${event}: existing output unchanged`);
    }
  });

  it("SEIT-F05 B30-240: the backend key appears in no output, diagnostic or owned file", async (t) => {
    const drv = await driver(t);
    const fx = setup(t, drv);
    writePlan(fx.project, choice());
    const runs = [await runHost(fx, "SessionStart"), await runHost(fx, "Stop")];
    drv.set(() => ({ status: 401, text: `{"error":"bad key ${KEY}"}` }));
    writePlan(fx.project, choice());
    runs.push(await runHost(fx, "Stop"));
    for (const run of runs) assertNoLeak(run);
    for (const file of filesUnder(fx.tmp)) assert.ok(!readFileSync(file, "utf8").includes(KEY), `key written to ${path.relative(fx.tmp, file)}`);
  });

  it("SEIT-B30-207 B30-506: hosts register only the approved event surfaces", () => {
    const claude = JSON.parse(readFileSync(path.join(ROOT, "hooks/hooks.json"), "utf8")).hooks;
    const cursor = JSON.parse(readFileSync(path.join(ROOT, "hooks/com.cursor/hooks.json"), "utf8")).hooks;
    const registrations = (hooks) => Object.fromEntries(Object.entries(hooks).map(([event, entries]) => [
      event, entries.flatMap((entry) => (entry.hooks ?? [entry]).map((hook) => {
        const script = hook.command.match(/([\w.-]+\.cjs)(?=["\s]|$)/)?.[1];
        return entry.matcher ? `${entry.matcher}: ${script}` : script;
      })).sort(),
    ]));
    const writes = "Write|Edit|MultiEdit|NotebookEdit|apply_patch|Bash";
    assert.deepEqual(registrations(claude), {
      SessionStart: ["host.cjs"],
      PreToolUse: [`${writes}: orchestrator-write-lock.cjs`, `${writes}: te-host.cjs`, "assurance-dispatch.cjs"],
      Stop: ["git-sync.cjs", "host.cjs", "te-host.cjs"],
      SubagentStop: ["te-host.cjs"],
    });
    const cursorWrites = ["assurance-dispatch.cjs", "orchestrator-write-lock.cjs", "te-host.cjs"];
    assert.deepEqual(registrations(cursor), {
      sessionStart: ["host.cjs"],
      stop: ["git-sync.cjs", "host.cjs"],
      preToolUse: cursorWrites,
      beforeShellExecution: cursorWrites,
    });
  });

  it("B30-209: the provider capability matrix states the adapter is wired into host.cjs SessionStart and Stop", () => {
    const doc = readFileSync(path.join(ROOT, "docs/harness-compatibility.md"), "utf8");
    const section = doc.slice(doc.indexOf("## Decision-adapter column"));
    assert.ok(section.startsWith("## Decision-adapter column"), "decision-adapter section present");
    assert.doesNotMatch(section, /No `decision-adapter` module exists/, "stale: the adapter module exists since S10");
    for (const host of ["Claude Code", "Codex"]) {
      const row = section.split("\n").find((line) => line.startsWith(`| ${host} |`));
      assert.ok(row, `${host} row present`);
      const [, sessionStart, , stop] = row.split(" | ");
      for (const [event, cell] of [["SessionStart", sessionStart], ["Stop", stop]]) {
        assert.doesNotMatch(cell, /does not call an adapter|no adapter call/i, `${host} ${event} cell still says the handler has no adapter call`);
      }
    }
  });
});

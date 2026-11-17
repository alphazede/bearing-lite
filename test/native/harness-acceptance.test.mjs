/**
 * #92 real-harness acceptance: the packed distributable inside each advertised harness.
 *
 * Opt-in native suite (the default gate `test/*.test.mjs` does not run files under
 * `test/native/`). It packs the actual distributable with `npm pack`, extracts it,
 * overlays only the host manifest from the checkout (`.claude-plugin/`, `.codex-plugin/`,
 * `.cursor-plugin/` and `.agy/plugin.json` ship outside the npm file set), installs the
 * result into disposable HOMEs, and asserts native harness evidence:
 *
 *   TC-PACK-01    packed artifact identity (digest, version, file set)
 *   TC-CODEX-DISC-01 / TC-CODEX-EXEC-01 / TC-CODEX-NEG-01
 *                 Codex app-server discovery + loopback exec: allowed counterpart launches,
 *                 excess slot blocked (marker, hook reservation, harness-recorded denial in
 *                 the native tool return), disabled-plugin negative control
 *   TC-CODEX-FAIL-01..03
 *                 missing hook file / failing hook / malformed hook response: session survives
 *   TC-CLAUDE-DISC-01  marketplace install, registered skills/hooks, referenced resources
 *   TC-MUSE-ISC-01 / TC-MUSE-PLUG-01
 *                 per-skill install and portable-bundle install, skill discovery, hooks []
 *   TC-AGY-DISC-01 / TC-AGY-SYMLINK-01
 *                 copy install + validate (16 skills, 0 hooks); documented symlink path FAIL
 *   TC-CURSOR-UNAVAIL-01 / TC-COPILOT-CLI-UNAVAIL-01 / TC-PI-UNAVAIL-01
 *                 disposable profiles cannot authenticate (or the binary is absent): the
 *                 blocker is recorded as UNAVAILABLE, never PASS
 *
 * No model call is made against a paid provider: Codex exec uses an owned loopback
 * Responses driver with fixed tool calls (model-refusal confound absent by construction);
 * every other harness is exercised through credential-free install/validate/list surfaces.
 * A disposable profile that cannot authenticate is an explicit UNAVAILABLE record.
 * Resource group: one disposable root per case; loopback bind(0); bounded child timeouts.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PKG = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const CODEX = process.env.BEARING_CODEX_BIN || "codex";
const MUSE = process.env.BEARING_MUSE_BIN || "muse";
const CLAUDE = process.env.BEARING_CLAUDE_BIN || "claude";
const AGY = process.env.BEARING_AGY_BIN || "agy";
const CURSOR = process.env.BEARING_CURSOR_BIN || "cursor-agent";
const CALL_TIMEOUT_MS = 60_000;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function skillDirs(pkgDir) {
  return readdirSync(path.join(pkgDir, "skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(pkgDir, "skills", d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

function revision() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : "unavailable";
}

function gitVersion(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 10_000 });
  return r.error ? `unavailable (${r.error.code ?? r.error.message})`
    : (r.stdout || "").trim().split("\n")[0].slice(0, 80) || `exit ${r.status}`;
}

/** Bounded sync spawn that never leaks the caller env into disposable profiles. */
function run(bin, args, { env, cwd, input, timeout = CALL_TIMEOUT_MS }) {
  const r = spawnSync(bin, args, {
    cwd: cwd ?? env?.TMPDIR ?? ROOT, env, encoding: "utf8", timeout, input,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function ok(bin, args, opts) {
  const r = run(bin, args, opts);
  assert.equal(r.error, undefined, `ENVIRONMENT_FAILURE: ${bin} ${args.join(" ")}: ${r.error?.message}`);
  assert.equal(r.status, 0, `ENVIRONMENT_FAILURE: ${bin} ${args.join(" ")} status=${r.status}\n${r.stderr.slice(-2000)}`);
  return r.stdout;
}

/** Extract the trailing JSON payload from harness output that prepends hook noise. */
function jsonTail(text, startChar) {
  const i = text.indexOf(startChar);
  assert.ok(i >= 0, `no JSON payload starting with '${startChar}' in: ${text.slice(0, 500)}`);
  return JSON.parse(text.slice(i));
}

const shared = {};

/** One disposable root for the whole file; harness homes live underneath. */
before(() => {
  shared.tmp = mkdtempSync(path.join(os.tmpdir(), `bearing-92-${process.pid}-${process.hrtime.bigint()}-`));
  shared.rev = revision();
  shared.os = `${process.platform}-${process.arch} ${os.release()}`;
  shared.home = path.join(shared.tmp, "home");
  for (const d of [shared.home]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: shared.home, LANG: "C.UTF-8", TMPDIR: shared.tmp };
  shared.envRoot = env;

  // TC-PACK-01: pack the actual distributable and extract it. Only the host
  // manifest overlays (never shipped by npm) are copied from the checkout.
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json"], {
    cwd: ROOT, encoding: "utf8", timeout: 60_000,
  });
  assert.equal(packed.status, 0, `ENVIRONMENT_FAILURE: npm pack: ${packed.stderr}`);
  const report = JSON.parse(packed.stdout)[0];
  assert.equal(report.name, PKG.name);
  assert.equal(report.version, PKG.version);
  const tgz = path.join(ROOT, report.filename);
  shared.tzSha = sha256(tgz);
  shared.pkg = path.join(shared.tmp, "pkg");
  mkdirSync(shared.pkg);
  const x = spawnSync("tar", ["xzf", tgz, "-C", shared.pkg, "--strip-components=1"], { encoding: "utf8", timeout: 60_000 });
  assert.equal(x.status, 0, `ENVIRONMENT_FAILURE: tar extract: ${x.stderr}`);
  rmSync(tgz, { force: true });
  shared.skills = skillDirs(shared.pkg);
  assert.ok(shared.skills.length >= 15, `expected >=15 packaged skills, got ${shared.skills.length}`);
});

after(() => { if (shared.tmp) rmSync(shared.tmp, { recursive: true, force: true }); });

describe("TC-PACK-01 packed distributable identity", () => {
  it("installs the artifact whose digest the matrix records", (t) => {
    t.diagnostic(`plugin ${PKG.name}@${PKG.version} revision ${shared.rev}`);
    t.diagnostic(`distributable sha256 ${shared.tzSha}; OS ${shared.os}`);
    const files = shared.skills;
    assert.equal(files.length, 16, "packaged skill count changed; update matrix");
    for (const f of ["plugin.json", "hooks/hooks.json", "hooks/assurance-dispatch.cjs", "profiles.json"]) {
      assert.ok(existsSync(path.join(shared.pkg, f)), `packed file missing: ${f}`);
      assert.equal(sha256(path.join(shared.pkg, f)), sha256(path.join(ROOT, f)), `${f} differs from checkout`);
    }
    // Referenced resources ship with the skill that references them.
    const ref = path.join(shared.pkg, "skills", "bearing-lite", "references", "assurance-policy.md");
    assert.ok(existsSync(ref), "bearing-lite referenced resource missing from package");
    assert.equal(sha256(ref),
      sha256(path.join(ROOT, "skills", "bearing-lite", "references", "assurance-policy.md")));
  });
});

// --- Codex helpers ---------------------------------------------------------

function freshCodex(t, label) {
  const dir = path.join(shared.tmp, `codex-${label}`);
  const home = path.join(dir, "home"), codexHome = path.join(dir, "codex-home"), repo = path.join(dir, "repo");
  for (const d of [home, codexHome, repo]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome, LANG: "C.UTF-8", TMPDIR: dir };
  const check = run(CODEX, ["--version"], { env });
  assert.ok(!check.error && check.status === 0,
    `ENVIRONMENT_FAILURE: required native prerequisite '${CODEX}' unavailable (${check.error?.message ?? `status ${check.status}`}); install Codex CLI or set BEARING_CODEX_BIN`);
  t.diagnostic(`codex ${check.stdout.trim()}; pinned release target 0.162.1; ${label}`);
  ok(process.execPath, [path.join(ROOT, "tools", "prepare-codex-plugin.mjs"), "--out", path.join(dir, "marketplace")], { env });
  ok(CODEX, ["plugin", "marketplace", "add", path.join(dir, "marketplace")], { env, cwd: repo });
  ok(CODEX, ["plugin", "add", "bearing-lite@bearing-lite"], { env, cwd: repo });
  const ver = JSON.parse(readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;
  const installedRoot = path.join(codexHome, "plugins", "cache", "bearing-lite", "bearing-lite", ver);
  assert.ok(existsSync(installedRoot), `codex plugin add did not create ${installedRoot}`);
  assert.equal(sha256(path.join(installedRoot, "hooks", "assurance-dispatch.cjs")),
    sha256(path.join(shared.pkg, "hooks", "assurance-dispatch.cjs")), "installed hook bytes differ from packed artifact");
  return { env, codexHome, repo, installedRoot };
}

async function writeLoopbackExec(t, fx, { ids, prompt, timeoutMs = 90_000 }) {
  const { env, repo } = fx;
  const marker = path.join(repo, "launches.txt");
  const sentinel = path.join(repo, "sentinel.cjs");
  writeFileSync(sentinel, "require('node:fs').appendFileSync(process.argv[2], process.argv[3] + '\\n');\n");
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  const commands = Object.fromEntries(ids.map((id) => [id, `node '${sentinel}' '${marker}' '${id}'`]));
  let toolName, toolArgs, steps = 0;
  const nativeToolReturns = [];
  const sse = (res, data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
  const fixture = (tools) => {
    const tool = tools.find((s) => s.name === "exec_command") || tools.find((s) => s.name === "shell_command");
    assert.ok(tool, `CONTRACT_FAILURE: no native shell function in ${JSON.stringify(tools.map((s) => s.name))}`);
    toolName = tool.name;
    toolArgs = (id) => (toolName === "exec_command" ? { cmd: commands[id], max_output_tokens: 1000 } : { command: commands[id] });
    const slots = ids.map((id) => ({ id, kind: "review", group: id, unit_id: "W1", candidate: "candidate-a", scope: "native-sentinel", tool_name: "Bash", tool_input: { command: commands[id] } }));
    const decl = path.join(repo, "implementation.json");
    writeFileSync(decl, JSON.stringify({ waves: [{ id: "W1" }], journey_settings: { lifecycle_id: "native-test", assurance_dispatch: { slots } } }, null, 2) + "\n");
    writeFileSync(path.join(repo, "task-record.json"), JSON.stringify({ journey: "native-test", units: [{ unit_id: "W1", unit_kind: "wave", assurance_rounds: 0, assurance_repairs: 0, receipts: [{ kind: "gate_chain", unit_id: "W1", verdict: "PASS" }] }], dispatch_log: [], amendments: [] }, null, 2) + "\n");
    writeFileSync(path.join(repo, "plan.md"), `# Native fixture plan\n- assurance_dispatch: ${JSON.stringify({ journey: "native-test", declaration_path: "implementation.json", declaration_sha256: sha256(decl), task_record_path: "task-record.json" })}\n`);
  };
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      nativeToolReturns.push(...(input.input || []).filter((i) => i.type === "function_call_output").map((i) => i.output));
      if (!toolName) fixture(input.tools || []);
      const id = ids[steps++] ?? null;
      const item = id
        ? { type: "function_call", id: `fc_${steps}`, call_id: `call_${steps}`, name: toolName, arguments: JSON.stringify(toolArgs(id)), status: "completed" }
        : { type: "message", id: "msg_done", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Native sentinel sequence complete.", annotations: [] }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      sse(res, { type: "response.created", response: { id: `resp_${steps}`, status: "in_progress", output: [] } });
      sse(res, { type: "response.output_item.done", output_index: 0, item });
      sse(res, { type: "response.completed", response: { id: `resp_${steps}`, object: "response", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      res.end();
    } catch (e) { res.writeHead(500); res.end("driver failure"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const args = ["exec", "--json", "--skip-git-repo-check", "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust",
    "-c", 'model_provider="sentinel"', "-c", 'model="sentinel"', "-c", 'model_providers.sentinel.name="Owned local sentinel"',
    "-c", `model_providers.sentinel.base_url="${url}"`, "-c", 'model_providers.sentinel.wire_api="responses"',
    "-c", "model_providers.sentinel.requires_openai_auth=false", "-c", "model_providers.sentinel.request_max_retries=0",
    "-c", "model_providers.sentinel.stream_max_retries=0", "-c", "features.shell_snapshot=false", prompt];
  let child, stdout = "", stderr = "";
  try {
    const exit = await new Promise((resolve, reject) => {
      child = spawn(CODEX, args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`ENVIRONMENT_FAILURE: native deadline; stderr ${stderr.slice(-1500)}`)); }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    assert.equal(exit.code, 0, `native exit=${exit.code} signal=${exit.signal}; ${stderr.slice(-1500)}; events ${stdout.slice(-1500)}`);
    const record = existsSync(path.join(repo, "task-record.json"))
      ? JSON.parse(readFileSync(path.join(repo, "task-record.json"), "utf8")) : null;
    return {
      marker: existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : [],
      record, returns: nativeToolReturns.join("\n"), stdout, stderr,
    };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

describe("Codex native execution (TC-CODEX-EXEC-01)", () => {
  it("allowed counterpart launches; excess slot blocked with hook reservation evidence", { timeout: 120_000 }, async (t) => {
    const fx = freshCodex(t, "exec");
    const r = await writeLoopbackExec(t, fx, { ids: ["first", "excess"], prompt: "Execute the fixed local sentinel sequence." });
    // Allowed counterpart succeeded through the real harness event path.
    assert.deepEqual(r.marker, ["first"], "prohibited excess launch must stay out of the sentinel marker");
    // The hook ran with the expected payload: it reserved the first slot only.
    assert.equal(r.record.dispatch_log.length, 1, `hook reservation missing: ${JSON.stringify(r.record?.dispatch_log)}`);
    assert.equal(r.record.dispatch_log[0].slot_id, "first");
    assert.equal(r.record.dispatch_log[0].result, "RESERVED");
    assert.ok(typeof r.record.dispatch_log[0].launch_sha256 === "string" && r.record.dispatch_log[0].launch_sha256.length === 64,
      "reservation must carry the launch digest");
    // Blocking was enforced by the harness, echoed into the native tool return.
    assert.match(r.returns, /Command blocked by PreToolUse hook: Bearing Lite assurance dispatch: HALT: assurance_round_limit/,
      "harness-recorded denial must reach the tool return");
    assert.doesNotMatch(r.returns, /assurance_round_limit.*first/);
    t.diagnostic(`blocking: marker=${JSON.stringify(r.marker)} dispatch_log=${r.record.dispatch_log.length} denial visible in tool return`);
  });

  it("negative control: disabled plugin reserves nothing and blocks nothing", { timeout: 120_000 }, async (t) => {
    const fx = freshCodex(t, "neg");
    const config = path.join(fx.codexHome, "config.toml");
    const before = readFileSync(config, "utf8");
    const header = '[plugins."bearing-lite@bearing-lite"]\nenabled = true';
    assert.ok(before.includes(header), `harness precondition: no enabled entry: ${before}`);
    writeFileSync(config, before.replace(header, header.replace("true", "false")));
    try {
      const r = await writeLoopbackExec(t, fx, { ids: ["first", "excess"], prompt: "Execute the fixed local sentinel sequence." });
      assert.deepEqual(r.marker, ["first", "excess"],
        "disabled plugin must not block: both fixed calls launch");
      assert.equal(r.record.dispatch_log.length, 0,
        "disabled plugin must reserve nothing (attributable to the control)");
      assert.doesNotMatch(r.returns, /blocked by PreToolUse hook/,
        "no hook denial may appear with the plugin disabled");
      t.diagnostic("negative control: marker gained excess and dispatch_log stayed empty; change attributable to enabled=false");
    } finally {
      writeFileSync(config, before);
    }
  });

  it("failure: missing hook dependency fails open without killing the session", { timeout: 120_000 }, async (t) => {
    const fx = freshCodex(t, "fail-missing");
    rmSync(path.join(fx.installedRoot, "hooks", "assurance-dispatch.cjs"), { force: true });
    const r = await writeLoopbackExec(t, fx, { ids: ["first", "excess"], prompt: "Execute the fixed local sentinel sequence." });
    assert.deepEqual(r.marker, ["first", "excess"],
      "with the dispatch hook file missing, the excess call is no longer blocked");
    assert.equal(r.record.dispatch_log.length, 0, "missing hook must reserve nothing");
    t.diagnostic("missing dependency: spawn failure is non-fatal; session completed (fail-open)");
  });

  it("failure: hook exiting 1 fails open without killing the session", { timeout: 120_000 }, async (t) => {
    const fx = freshCodex(t, "fail-exit");
    const hookFile = path.join(fx.installedRoot, "hooks", "assurance-dispatch.cjs");
    writeFileSync(hookFile, "process.exit(1);\n" + readFileSync(hookFile, "utf8"));
    const r = await writeLoopbackExec(t, fx, { ids: ["first", "excess"], prompt: "Execute the fixed local sentinel sequence." });
    assert.deepEqual(r.marker, ["first", "excess"],
      "a non-zero hook exit must not block the calls and must not kill the session");
    assert.equal(r.record.dispatch_log.length, 0, "exited hook must reserve nothing");
    t.diagnostic("failing hook: exit 1 is non-fatal and non-blocking for advisory dispatch");
  });

  it("failure: malformed hook response fails open without killing the session", { timeout: 120_000 }, async (t) => {
    const fx = freshCodex(t, "fail-malformed");
    writeFileSync(path.join(fx.installedRoot, "hooks", "assurance-dispatch.cjs"),
      "console.log('NOT-JSON-MALFORMED');\nprocess.exit(0);\n");
    const r = await writeLoopbackExec(t, fx, { ids: ["first", "excess"], prompt: "Execute the fixed local sentinel sequence." });
    assert.deepEqual(r.marker, ["first", "excess"],
      "malformed hook output must not block the calls and must not kill the session");
    assert.equal(r.record.dispatch_log.length, 0, "malformed hook must reserve nothing");
    t.diagnostic("malformed response: non-JSON hook output is non-fatal and non-blocking");
  });
});

// --- Claude Code ------------------------------------------------------------

function freshClaude(t) {
  const dir = path.join(shared.tmp, "claude");
  const home = path.join(dir, "home"), repo = path.join(dir, "repo");
  for (const d of [home, repo]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: home, LANG: "C.UTF-8", TMPDIR: dir };
  // Disposable marketplace: packed payload + .claude-plugin host manifest overlay.
  const mkt = path.join(dir, "marketplace");
  cpSync(shared.pkg, mkt, { recursive: true });
  cpSync(path.join(ROOT, ".claude-plugin"), path.join(mkt, ".claude-plugin"), { recursive: true });
  ok(CLAUDE, ["plugin", "marketplace", "add", mkt], { env, cwd: repo });
  ok(CLAUDE, ["plugin", "install", "bearing-lite@bearing-lite"], { env, cwd: repo });
  return { env, home, repo, mkt };
}

describe("Claude Code (TC-CLAUDE-DISC-01)", () => {
  it("installs the packed artifact, registers 16 skills and 4 hook events", (t) => {
    const fx = freshClaude(t);
    const ver = run(CLAUDE, ["--version"], { env: fx.env });
    t.diagnostic(`claude ${ver.stdout.trim() || `exit ${ver.status}`}; OS ${shared.os}`);
    const list = jsonTail(ok(CLAUDE, ["plugin", "list", "--json"], { env: fx.env, cwd: fx.repo }), "[");
    const entry = list.find((p) => p.id === "bearing-lite@bearing-lite");
    assert.ok(entry, `plugin not listed: ${JSON.stringify(list).slice(0, 500)}`);
    assert.equal(entry.version, PKG.version);
    assert.equal(entry.enabled, true);
    const installedRoot = entry.installPath;
    assert.ok(existsSync(installedRoot), "installed artifact path missing");
    assert.equal(sha256(path.join(installedRoot, "skills", "intake", "SKILL.md")),
      sha256(path.join(shared.pkg, "skills", "intake", "SKILL.md")), "installed skill differs from packed artifact");
    assert.equal(sha256(path.join(installedRoot, "hooks", "hooks.json")),
      sha256(path.join(shared.pkg, "hooks", "hooks.json")), "installed hooks differ from packed artifact");
    const details = ok(CLAUDE, ["plugin", "details", "bearing-lite"], { env: fx.env, cwd: fx.repo });
    assert.match(details, /Skills \(16\)/, "details must inventory 16 packaged skills");
    assert.match(details, /Hooks \(4\)\s+SessionStart, PreToolUse, Stop, SubagentStop/,
      "details must register the four supported hook events");
    const validated = ok(CLAUDE, ["plugin", "validate", fx.mkt], { env: fx.env, cwd: fx.repo });
    for (const needle of ["assurance-dispatch.cjs", "orchestrator-write-lock.cjs", "te-host.cjs", "git-sync.cjs"]) {
      assert.ok(validated.includes(needle), `validate must declare hook ${needle}`);
    }
    t.diagnostic("install+discovery PASS; skill load PASS (16 skills, resources byte-identical); hook declarations validated at install time");
  });

  it("native event execution is UNAVAILABLE without operator credentials", (t) => {
    const fx = freshClaude(t);
    const r = run(CLAUDE, ["-p", "say hi", "--allowedTools", ""], { env: fx.env, cwd: fx.repo });
    const out = r.stdout + r.stderr;
    assert.match(out, /Not logged in/, `disposable profile must fail closed as unlogged, got: ${out.slice(0, 300)}`);
    t.diagnostic("TC-CLAUDE-EXEC-UNVERIFIED: hook events (advisory/blocking/failure) need an authenticated session; disposable profile cannot authenticate; recorded UNVERIFIED, not PASS");
  });
});

// --- Muse Code --------------------------------------------------------------

function freshMuse(t) {
  const dir = path.join(shared.tmp, "muse");
  const home = path.join(dir, "home"), xdg = path.join(dir, "xdg"), repo = path.join(dir, "repo");
  for (const d of [home, xdg, repo]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: xdg, LANG: "C.UTF-8", TMPDIR: dir };
  return { env, home, xdg, repo };
}

describe("Muse Code (TC-MUSE-ISC-01, TC-MUSE-PLUG-01)", () => {
  it("per-skill install discovers every packaged skill", (t) => {
    const fx = freshMuse(t);
    const ver = run(MUSE, ["--version"], { env: fx.env });
    t.diagnostic(`muse ${ver.stdout.trim() || `exit ${ver.status}`}; OS ${shared.os}`);
    for (const skill of shared.skills) {
      const out = ok(MUSE, ["skills", "install", path.join(shared.pkg, "skills", skill), "--scope", "user", "--json"], { env: fx.env, cwd: fx.repo });
      const parsed = jsonTail(out, "{");
      assert.equal(parsed.installed.id, skill, `install of ${skill} must succeed`);
    }
    const list = jsonTail(ok(MUSE, ["skills", "list", "--json"], { env: fx.env, cwd: fx.repo }), "{");
    const userSkills = (list.skills || []).filter((s) => s.scope === "user").map((s) => s.name);
    for (const skill of shared.skills) {
      assert.ok(userSkills.includes(skill), `skill ${skill} missing from disposable discovery`);
    }
    const inspected = jsonTail(ok(MUSE, ["skills", "inspect", "bearing-lite", "--scope", "user", "--json"], { env: fx.env, cwd: fx.repo }), "{");
    assert.ok(inspected.skill.description.length > 20, "inspected skill must carry its packaged description");
    const installedBearing = path.join(fx.xdg, "muse", "skills", "bearing-lite", "SKILL.md");
    assert.ok(existsSync(installedBearing), "bearing-lite SKILL.md must be copied into disposable config");
    assert.equal(sha256(installedBearing), sha256(path.join(shared.pkg, "skills", "bearing-lite", "SKILL.md")));
    assert.ok(existsSync(path.join(fx.xdg, "muse", "skills", "bearing-lite", "references", "assurance-policy.md")),
      "referenced resource must be installed with the skill");
    t.diagnostic("skills install+discovery PASS; hooks UNSUPPORTED on the skills-only path (no hook surface)");
  });

  it("portable bundle install records identity, 16 skills, no hooks", (t) => {
    const fx = freshMuse(t);
    const validate = jsonTail(ok(MUSE, ["plugins", "validate", shared.pkg, "--json"], { env: fx.env, cwd: fx.repo }), "{");
    assert.equal(validate.capabilities.skills.length, 16, "bundle validate must find 16 skills");
    assert.deepEqual(validate.capabilities.hooks, [], "portable bundle declares no Muse hooks");
    const installed = jsonTail(ok(MUSE, ["plugins", "install", shared.pkg, "--json"], { env: fx.env, cwd: fx.repo }), "{");
    assert.equal(installed.installed.id, "bearing-lite");
    assert.equal(installed.installed.manifest_family, "agent-plugins");
    assert.equal(installed.installed.enabled, true);
    assert.ok(installed.installed.package_sha256, "install must record a package digest");
    assert.ok(installed.installed.manifest_sha256, "install must record a manifest digest");
    const list = jsonTail(ok(MUSE, ["plugins", "list", "--json"], { env: fx.env, cwd: fx.repo }), "{");
    const entry = (list.plugins || []).find((p) => p.plugin.id === "bearing-lite");
    assert.ok(entry && entry.active, "bundle must be listed active in disposable profile");
    assert.equal(entry.plugin.capabilities.skills.length, 16);
    assert.deepEqual(entry.plugin.capabilities.hooks, []);
    t.diagnostic(`bundle install PASS; package_sha256 ${installed.installed.package_sha256.slice(0, 16)} sight; hooks UNSUPPORTED`);
  });
});

// --- AGY --------------------------------------------------------------------

function freshAgy(t) {
  const dir = path.join(shared.tmp, "agy");
  const home = path.join(dir, "home"), repo = path.join(dir, "repo");
  for (const d of [home, repo]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH ?? "", HOME: home, LANG: "C.UTF-8", TMPDIR: dir };
  return { env, home, repo, dir };
}

describe("AGY (TC-AGY-DISC-01, TC-AGY-SYMLINK-01)", () => {
  it("copy install of packed payload registers 16 skills and 0 hooks", (t) => {
    const fx = freshAgy(t);
    const root = path.join(fx.dir, "install-root");
    mkdirSync(path.join(root, "skills"), { recursive: true });
    cpSync(path.join(ROOT, ".agy", "plugin.json"), path.join(root, "plugin.json"));
    cpSync(path.join(shared.pkg, "skills"), path.join(root, "skills"), { recursive: true, dereference: true });
    const installOut = ok(AGY, ["plugin", "install", root], { env: fx.env, cwd: fx.repo });
    const list = jsonTail(ok(AGY, ["plugin", "list", "--json"], { env: fx.env, cwd: fx.repo }), "[");
    assert.ok(list.some((p) => p.name === "bearing-lite"), `plugin not listed: ${JSON.stringify(list).slice(0, 300)}`);
    const validated = jsonTail(ok(AGY, ["plugin", "validate", root, "--json"], { env: fx.env, cwd: fx.repo }), "{");
    assert.equal(validated.components.skills, 16, "validate must find 16 packaged skills");
    assert.equal(validated.components.hooks, 0, "AGY is skills-only: validate must report 0 hooks");
    const installedSkill = path.join(fx.home, ".gemini", "config", "plugins", "bearing-lite", "skills", "intake", "SKILL.md");
    assert.ok(existsSync(installedSkill), "installed skill missing");
    assert.equal(sha256(installedSkill), sha256(path.join(shared.pkg, "skills", "intake", "SKILL.md")),
      "installed skill differs from packed artifact");
    t.diagnostic(`install+discovery PASS; skill load PASS; hooks UNSUPPORTED (validate hooks=0). install out: ${installOut.trim().split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300)}`);
  });

  it("documented symlink install FAILS natively on this build", (t) => {
    const fx = freshAgy(t);
    const root = path.join(fx.dir, "symlink-root");
    mkdirSync(root, { recursive: true });
    cpSync(path.join(ROOT, ".agy", "plugin.json"), path.join(root, "plugin.json"));
    // The README's documented install shape, as a disposable copy.
    symlinkSync(path.join(shared.pkg, "skills"), path.join(root, "skills"), "dir");
    const r = run(AGY, ["plugin", "install", root], { env: fx.env, cwd: fx.repo });
    assert.match(r.stdout + r.stderr, /points outside/,
      `symlink install must be refused natively, got: ${(r.stdout + r.stderr).slice(-500)}`);
    t.diagnostic("TC-AGY-SYMLINK-01 FAIL: documented symlink install refused (symlink points outside plugin root); copy install is the verified path");
  });
});

// --- UNAVAILABLE rows: honest blockers, never PASS ---------------------------

describe("unavailable or unverifiable rows (#92 honest recording)", () => {
  it("TC-CURSOR-UNAVAIL-01 cursor-agent needs credentials even to list", (t) => {
    const dir = path.join(shared.tmp, "cursor");
    const home = path.join(dir, "home"), repo = path.join(dir, "repo");
    for (const d of [home, repo]) mkdirSync(d, { recursive: true });
    const env = { PATH: process.env.PATH ?? "", HOME: home, LANG: "C.UTF-8", TMPDIR: dir };
    const ver = run(CURSOR, ["--version"], { env });
    t.diagnostic(`cursor-agent ${ver.stdout.trim() || `exit ${ver.status} ${ver.stderr.slice(0, 120)}`}`);
    const r = run(CURSOR, ["plugin", "marketplace", "list"], { env, cwd: repo });
    let blocker;
    if (r.error) {
      blocker = `binary unavailable (${r.error.code ?? r.error.message})`;
    } else {
      assert.match(r.stdout + r.stderr, /Authentication required/, "cursor-agent must refuse unauthenticated listing");
      blocker = "Authentication required for marketplace list; disposable profile cannot authenticate";
    }
    t.diagnostic(`TC-CURSOR-UNAVAIL-01 UNAVAILABLE: ${blocker}; Cursor rows recorded UNVERIFIED for hook execution`);
  });

  it("TC-COPILOT-CLI-UNAVAIL-01 copilot CLI binary absent on this host", (t) => {
    const env = { PATH: process.env.PATH ?? "", HOME: path.join(shared.tmp, "copilot-home"), LANG: "C.UTF-8", TMPDIR: shared.tmp };
    mkdirSync(env.HOME, { recursive: true });
    const r = run("copilot", ["plugin", "marketplace", "list"], { cwd: shared.tmp, env });
    const out = r.stdout + r.stderr;
    if (r.error) {
      t.diagnostic(`TC-COPILOT-CLI-UNAVAIL-01 UNAVAILABLE: binary ${r.error.code ?? r.error.message}`);
      return;
    }
    assert.match(out, /was not found/, `copilot shim must report the missing CLI, got: ${out.slice(0, 300)}`);
    t.diagnostic("TC-COPILOT-CLI-UNAVAIL-01 UNAVAILABLE: shipped shim reports the CLI is not installed");
  });

  it("TC-PI-UNAVAIL-01 pi binary absent on this host", (t) => {
    const env = { PATH: process.env.PATH ?? "", HOME: path.join(shared.tmp, "pi-home"), LANG: "C.UTF-8", TMPDIR: shared.tmp };
    mkdirSync(env.HOME, { recursive: true });
    const r = run("pi", ["--version"], { cwd: shared.tmp, env });
    assert.ok(r.error, "pi must be absent for this record; if pi appears, re-probe the Pi row");
    t.diagnostic(`TC-PI-UNAVAIL-01 UNAVAILABLE: binary ${r.error.code ?? r.error.message}`);
  });

  it("TC-VSCODE-UNVERIFIED-01 and TC-DEEPCODE-UNVERIFIED-01 need host surfaces that do not exist headlessly", (t) => {
    t.diagnostic("TC-VSCODE-UNVERIFIED-01 UNVERIFIED: VS Code Copilot plugin install requires the editor UI; no headless harness API exists on this machine");
    t.diagnostic("TC-DEEPCODE-UNVERIFIED-01 UNVERIFIED: DeepCode publishes no CLI or discovery API; a filesystem copy is not harness-observable");
  });
});






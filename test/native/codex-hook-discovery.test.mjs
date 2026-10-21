/**
 * D1 native regression: Codex must discover every hook the candidate package declares.
 *
 * Prepares the Codex-only install artifact with `tools/prepare-codex-plugin.mjs`, installs it
 * through the real `codex plugin marketplace add` / `codex plugin add` path into a disposable
 * HOME/CODEX_HOME, then asks the real Codex app-server `hooks/list` and `skills/list`
 * (credential-free, no model call) what it registered for the plugin.
 * Enabled install: every hooks/hooks.json registration and every packaged skill is present.
 * Disabled install: no Bearing hook is.
 * The default gate glob `test/*.test.mjs` does not run this file; release gating must run it explicitly.
 *
 * Required native prerequisite: the `codex` CLI (override with BEARING_CODEX_BIN).
 * Its absence fails this test; it never skips or passes.
 * Resource group: isolated Codex app-server per case; no shared ports, displays or user config.
 * Runs over 30 s worst case only when Codex is slow to start; each external call is bounded.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODEX = process.env.BEARING_CODEX_BIN || "codex";
const MARKETPLACE = "bearing-lite";
const PLUGIN_ID = `bearing-lite@${MARKETPLACE}`;
const CALL_TIMEOUT_MS = 60_000;
// Codex hooks/list event names for the Claude-style hooks.json keys.
const EVENT = { SessionStart: "sessionStart", PreToolUse: "preToolUse", Stop: "stop", SubagentStop: "subagentStop" };

/** @type {string} */ let tmp;
/** @type {Record<string, string>} */ let env;
/** @type {string} */ let repo;
/** @type {string} */ let installedRoot;

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: CALL_TIMEOUT_MS, ...opts });
  const diag = `${cmd} ${args.join(" ")} -> status=${r.status} signal=${r.signal} error=${r.error?.message}\nstdout: ${r.stdout}\nstderr: ${String(r.stderr).slice(-2000)}`;
  assert.equal(r.error, undefined, `ENVIRONMENT_FAILURE: ${diag}`);
  assert.equal(r.status, 0, `ENVIRONMENT_FAILURE: ${diag}`);
  return r.stdout;
}

/** Bounded stdio JSON-RPC session with the real Codex app-server. */
async function withAppServer(fn) {
  const child = spawn(CODEX, ["app-server"], { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let buf = "";
  let exit = null;
  const waiting = new Map();
  const fail = (why) => {
    for (const [, w] of waiting) w.reject(new Error(`${why}; stderr tail: ${stderr.slice(-2000)}`));
    waiting.clear();
  };
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("error", (e) => fail(`ENVIRONMENT_FAILURE: app-server spawn error ${e.message}`));
  child.on("exit", (code, signal) => { exit = { code, signal }; fail(`app-server exited code=${code} signal=${signal}`); });
  child.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); msg.error ? w.reject(new Error(`${w.method} error ${JSON.stringify(msg.error)}`)) : w.resolve(msg.result); }
    }
  });
  child.stdout.on("end", () => fail("app-server stdout EOF"));
  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out after ${CALL_TIMEOUT_MS} ms; stderr tail: ${stderr.slice(-2000)}`)); }, CALL_TIMEOUT_MS);
    waiting.set(id, {
      method,
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  try {
    await request("initialize", { clientInfo: { name: "bearing_d1_test", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
    return await fn(request);
  } finally {
    child.stdin.end();
    if (exit === null) {
      const gone = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await gone;
      clearTimeout(killer);
    }
  }
}

/** Every registration in the candidate hooks/hooks.json, as Codex should list it once installed. */
function expectedHooks() {
  const manifest = JSON.parse(readFileSync(path.join(installedRoot, "hooks", "hooks.json"), "utf8"));
  const out = [];
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    for (const group of groups) {
      for (const h of group.hooks) {
        out.push({
          eventName: EVENT[event] ?? `unmapped:${event}`,
          handlerType: h.type,
          command: h.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", installedRoot),
          matcher: group.matcher ?? null,
          timeoutSec: h.timeout,
          statusMessage: h.statusMessage,
        });
      }
    }
  }
  return out;
}

const sortKey = (h) => `${h.eventName}\0${h.statusMessage}\0${h.command}`;
const pick = ({ eventName, handlerType, command, matcher, timeoutSec, statusMessage }) =>
  ({ eventName, handlerType, command, matcher, timeoutSec, statusMessage });

async function listPluginState() {
  return withAppServer(async (request) => {
    const plugins = await request("plugin/list", { cwds: [repo] });
    const skills = await request("skills/list", { cwds: [repo] });
    const hooks = await request("hooks/list", { cwds: [repo] });
    const entry = plugins.marketplaces.flatMap((m) => m.plugins).find((p) => p.id === PLUGIN_ID);
    const data = hooks.data.find((d) => d.cwd === repo);
    assert.ok(data, `hooks/list returned no entry for the fixture cwd: ${JSON.stringify(hooks).slice(0, 2000)}`);
    const ourSkills = (skills.data.find((d) => d.cwd === repo)?.skills ?? []).filter((k) => k.pluginId === PLUGIN_ID);
    return { entry, data, ours: data.hooks.filter((h) => h.pluginId === PLUGIN_ID), ourSkills };
  });
}

describe("Codex native hook discovery for the installed candidate (D1)", () => {
  before(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), `bearing-d1-${process.pid}-${process.hrtime.bigint()}-`));
    const home = path.join(tmp, "home");
    const codexHome = path.join(tmp, "codex-home");
    const mkt = path.join(tmp, "codex-artifact");
    repo = path.join(tmp, "repo");
    for (const d of [home, codexHome, repo]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(repo, "README.md"), "fixture\n");
    env = { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: codexHome, LANG: "C.UTF-8", TMPDIR: tmp };

    const version = spawnSync(CODEX, ["--version"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: CALL_TIMEOUT_MS });
    assert.ok(!version.error && version.status === 0,
      `ENVIRONMENT_FAILURE: required native prerequisite '${CODEX}' unavailable (${version.error?.message ?? `status ${version.status}`}); install Codex CLI or set BEARING_CODEX_BIN`);

    const generator = path.join(ROOT, "tools", "prepare-codex-plugin.mjs");
    assert.ok(existsSync(generator), "contract: tools/prepare-codex-plugin.mjs is missing");
    run(process.execPath, [generator, "--out", mkt]);

    run(CODEX, ["plugin", "marketplace", "add", mkt]);
    const added = run(CODEX, ["plugin", "add", PLUGIN_ID]);
    const version_ = JSON.parse(readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8")).version;
    installedRoot = path.join(codexHome, "plugins", "cache", MARKETPLACE, "bearing-lite", version_);
    assert.ok(existsSync(installedRoot), `codex plugin add did not create ${installedRoot}: ${added}`);
  });

  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("installs the candidate's metadata and hook bytes, root manifest minus only $schema", () => {
    for (const f of [".codex-plugin/plugin.json", "hooks/hooks.json"]) {
      assert.equal(sha256(path.join(installedRoot, f)), sha256(path.join(ROOT, f)), `installed ${f} differs from candidate`);
    }
    const { $schema, ...rest } = JSON.parse(readFileSync(path.join(ROOT, "plugin.json"), "utf8"));
    assert.ok($schema, "portable source plugin.json must keep its $schema");
    assert.deepEqual(JSON.parse(readFileSync(path.join(installedRoot, "plugin.json"), "utf8")), rest);
    assert.equal(expectedHooks().length, 8, "candidate hooks/hooks.json should declare 8 registrations");
  });

  it("enabled install: Codex hooks/list registers every declared hook", async () => {
    const { entry, data, ours, ourSkills } = await listPluginState();
    assert.ok(entry?.installed && entry?.enabled, `harness precondition: ${PLUGIN_ID} not installed+enabled: ${JSON.stringify(entry)}`);
    const skillDirs = readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(ROOT, "skills", d.name, "SKILL.md"))).map((d) => d.name);
    assert.deepEqual(
      ourSkills.map((k) => k.path).sort(),
      skillDirs.map((d) => path.join(installedRoot, "skills", d, "SKILL.md")).sort(),
      "Codex skills/list must load every packaged skill from the installed artifact",
    );
    for (const d of skillDirs) {
      assert.equal(sha256(path.join(installedRoot, "skills", d, "SKILL.md")), sha256(path.join(ROOT, "skills", d, "SKILL.md")), `installed skill ${d} differs`);
    }
    assert.deepEqual(
      ours.map(pick).sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      expectedHooks().sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
      `D1: Codex discovered ${ours.length}/8 Bearing hooks; warnings=${JSON.stringify(data.warnings)} errors=${JSON.stringify(data.errors)}`,
    );
    for (const h of ours) assert.equal(h.sourcePath, path.join(installedRoot, "hooks", "hooks.json"));
  });

  it("disabled install: Codex registers no Bearing hooks", async () => {
    // `-c plugins...enabled=false` is not honored by app-server plugin/list on 0.162.1, so flip the synthetic config.
    const config = path.join(env.CODEX_HOME, "config.toml");
    const enabled = readFileSync(config, "utf8");
    const header = `[plugins."${PLUGIN_ID}"]\nenabled = true`;
    assert.ok(enabled.includes(header), `harness precondition: codex plugin add wrote no enabled entry: ${enabled}`);
    writeFileSync(config, enabled.replace(header, header.replace("true", "false")));
    let state;
    try { state = await listPluginState(); } finally { writeFileSync(config, enabled); }
    const { entry, ours } = state;
    assert.ok(entry?.installed && entry?.enabled === false, `harness precondition: ${PLUGIN_ID} not installed+disabled: ${JSON.stringify(entry)}`);
    assert.deepEqual(ours, []);
  });
});

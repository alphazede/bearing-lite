/**
 * Alphazedehq#634 native Codex Stop-hook check.
 *
 * Uses a local loopback Responses driver (no paid model calls) and an isolated
 * HOME/CODEX_HOME with the prepared candidate plugin to prove:
 * 1. Fresh/trusted plugin hooks complete SessionStart and all three Stop hooks
 *    (`host.cjs`, `te-host.cjs`, `git-sync.cjs`) under real `codex exec`.
 * 2. Changing only the saved content hash makes Codex report modified trust
 *    and fail those same hooks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CODEX = process.env.BEARING_CODEX_BIN || "codex";
const PLUGIN_ID = "bearing-lite@bearing-lite";

function runSync(cmd, args, env, cwd, timeout = 60_000) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout });
  assert.equal(r.error, undefined, `ENVIRONMENT_FAILURE: ${cmd} ${args.join(" ")} -> ${r.error?.message}`);
  assert.equal(r.status, 0, `ENVIRONMENT_FAILURE: ${cmd} ${args.join(" ")} exit=${r.status}\n${r.stderr}`);
  return r.stdout;
}

async function listHookTrust(repo, env) {
  const child = spawn(CODEX, ["app-server", "--stdio"], {
    cwd: repo, env, stdio: ["pipe", "pipe", "ignore"],
  });
  const closed = new Promise(resolve => child.once("close", resolve));
  const lines = createInterface({ input: child.stdout });
  const send = (method, params, id) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex hooks/list timed out")), 10_000);
      const finish = () => clearTimeout(timer);
      child.once("error", error => { finish(); reject(error); });
      child.once("close", code => { finish(); reject(new Error(`Codex app-server exited with ${code}`)); });
      child.stdin.on("error", error => { finish(); reject(error); });
      lines.on("line", line => {
        try {
          const response = JSON.parse(line);
          if (response.error) throw new Error(JSON.stringify(response.error));
          if (response.id === 1) {
            send("initialized");
            send("hooks/list", { cwds: [repo] }, 2);
          }
          if (response.id === 2) {
            const entry = response.result.data.find(item => item.cwd === repo);
            assert.ok(entry, "Codex did not list hooks for the test repository");
            assert.deepEqual(entry.errors, []);
            finish();
            resolve(entry.hooks.filter(hook => hook.pluginId === PLUGIN_ID &&
              ["sessionStart", "stop"].includes(hook.eventName)));
          }
        } catch (error) {
          finish();
          reject(error);
        }
      });
      send("initialize", { clientInfo: { name: "bearing_stop_test", version: "0" } }, 1);
    });
  } finally {
    lines.close();
    child.stdin.end();
    child.kill("SIGKILL");
    await closed;
  }
}

async function withLoopbackCodex(repo, env, timeoutMs = 45_000) {
  let server;
  let child;
  const groups = new Set();
  try {
    server = http.createServer(async (req, res) => {
      for await (const _ of req) { /* drain */ }
      const item = {
        type: "message",
        id: "msg_ok",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "OK", annotations: [] }],
      };
      const sse = (d) => res.write(`event: ${d.type}\ndata: ${JSON.stringify(d)}\n\n`);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      sse({ type: "response.created", response: { id: "resp_1", status: "in_progress", output: [] } });
      sse({ type: "response.output_item.done", output_index: 0, item });
      sse({
        type: "response.completed",
        response: { id: "resp_1", object: "response", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
      });
      res.end();
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const url = `http://127.0.0.1:${server.address().port}/v1`;
    const args = [
      "exec", "--skip-git-repo-check", "--ephemeral",
      "-c", 'model_provider="sentinel"',
      "-c", 'model="sentinel"',
      "-c", 'model_providers.sentinel.name="Owned local sentinel"',
      "-c", `model_providers.sentinel.base_url="${url}"`,
      "-c", 'model_providers.sentinel.wire_api="responses"',
      "-c", "model_providers.sentinel.requires_openai_auth=false",
      "-c", "model_providers.sentinel.request_max_retries=0",
      "-c", "model_providers.sentinel.stream_max_retries=0",
      "-c", "features.shell_snapshot=false",
      "Reply OK.",
    ];
    let stdout = "";
    let stderr = "";
    const exit = await new Promise((resolve, reject) => {
      child = spawn(CODEX, args, { cwd: repo, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      if (child.pid && process.platform !== "win32") groups.add(child.pid);
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`codex exec timed out; stderr=${stderr.slice(-1500)}`));
      }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    return { exit, stdout, stderr };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
    for (const pid of groups) {
      try { process.kill(-pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
    }
  }
}

test("Alphazedehq#634 Bearing Stop hooks complete under Codex when trusted and fail pre-exec on stale trusted_content_hash", { timeout: 60_000 }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), `bearing-634-${process.pid}-`));
  const home = path.join(tmp, "home");
  const codexHome = path.join(tmp, "codex-home");
  const repo = path.join(tmp, "repo");
  for (const d of [home, codexHome, repo]) mkdirSync(d, { recursive: true });
  const env = { PATH: process.env.PATH || "", HOME: home, XDG_CONFIG_HOME: path.join(tmp, "xdg"), CODEX_HOME: codexHome, LANG: "C.UTF-8", TMPDIR: tmp };
  mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });

  try {
    runSync(CODEX, ["--version"], env, repo);
    runSync(process.execPath, [path.join(ROOT, "tools/prepare-codex-plugin.mjs"), "--out", path.join(tmp, "marketplace")], env, repo);
    runSync(CODEX, ["plugin", "marketplace", "add", path.join(tmp, "marketplace")], env, repo);
    runSync(CODEX, ["plugin", "add", PLUGIN_ID], env, repo);

    const hooks = await listHookTrust(repo, env);
    assert.equal(hooks.filter(hook => hook.eventName === "stop").length, 3);
    assert.equal(hooks.filter(hook => hook.eventName === "sessionStart").length, 1);
    const configPath = path.join(codexHome, "config.toml");
    const pluginConfig = readFileSync(configPath, "utf8");
    const hashes = hooks.map(({ key, currentHash }) => {
      assert.match(currentHash, /^sha256:[a-f0-9]{64}\/sha256:[a-f0-9]{64}$/);
      const [commandHash, contentHash] = currentHash.split("/");
      return { key, commandHash, contentHash };
    });
    const saveTrust = (stale) => writeFileSync(configPath, pluginConfig + hashes.map(
      ({ key, commandHash, contentHash }) => [
        "",
        `[hooks.state.${JSON.stringify(key)}]`,
        `trusted_hash = "${commandHash}"`,
        `trusted_content_hash = "${stale ? "sha256:" + "0".repeat(64) : contentHash}"`,
        "",
      ].join("\n")
    ).join("\n"));
    const assertTrust = async (status) => {
      const current = await listHookTrust(repo, env);
      assert.deepEqual(current.map(hook => hook.key).sort(), hooks.map(hook => hook.key).sort());
      assert.deepEqual([...new Set(current.map(hook => hook.trustStatus))], [status]);
    };

    saveTrust(false);
    await assertTrust("trusted");
    const ok = await withLoopbackCodex(repo, env);
    assert.equal(ok.exit.code, 0, ok.stderr);
    const completedStops = ok.stderr.match(/^hook: Stop Completed$/gm) || [];
    const failedStops = ok.stderr.match(/^hook: Stop Failed$/gm) || [];
    assert.equal(completedStops.length, 3, `expected 3 completed Stop hooks; stderr:\n${ok.stderr}`);
    assert.equal(failedStops.length, 0, `unexpected failed Stop hooks; stderr:\n${ok.stderr}`);
    assert.match(ok.stderr, /^hook: SessionStart Completed$/m, ok.stderr);

    saveTrust(true);
    await assertTrust("modified");
    const stale = await withLoopbackCodex(repo, env);
    assert.equal(stale.exit.code, 0, stale.stderr);
    const staleFailedStops = stale.stderr.match(/^hook: Stop Failed$/gm) || [];
    assert.equal(staleFailedStops.length, 3, `expected 3 failed Stop hooks on stale trust hash; stderr:\n${stale.stderr}`);
    assert.match(stale.stderr, /^hook: SessionStart Failed$/m);
    assert.doesNotMatch(stale.stderr, /^hook: (?:SessionStart|Stop) Completed$/m);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

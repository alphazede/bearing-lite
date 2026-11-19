/**
 * Alphazedehq#634 native Codex Stop-hook check.
 *
 * Uses a local loopback Responses driver (no paid model calls) and an isolated
 * HOME/CODEX_HOME with the prepared candidate plugin to prove:
 * 1. Fresh/trusted plugin hooks complete SessionStart and all three Stop hooks
 *    (`host.cjs`, `te-host.cjs`, `git-sync.cjs`) under real `codex exec`.
 * 2. A stale `trusted_content_hash` in `[hooks.state]` reproduces the exact
 *    pre-execution failure (`plugin contents changed; hook approval required` /
 *    `hook: Stop Failed` x3) without spawning Node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CODEX = process.env.BEARING_CODEX_BIN || "codex";

function runSync(cmd, args, env, cwd, timeout = 60_000) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout });
  assert.equal(r.error, undefined, `ENVIRONMENT_FAILURE: ${cmd} ${args.join(" ")} -> ${r.error?.message}`);
  assert.equal(r.status, 0, `ENVIRONMENT_FAILURE: ${cmd} ${args.join(" ")} exit=${r.status}\n${r.stderr}`);
  return r.stdout;
}

async function withLoopbackCodex(repo, env, extraArgs, timeoutMs = 45_000) {
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
      "exec", "--skip-git-repo-check", "--ephemeral", "--dangerously-bypass-approvals-and-sandbox",
      ...extraArgs,
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
    runSync(CODEX, ["plugin", "add", "bearing-lite@bearing-lite"], env, repo);

    // 1. Trusted candidate plugin hooks complete SessionStart + all 3 Stop hooks under Codex.
    const ok = await withLoopbackCodex(repo, env, ["--dangerously-bypass-hook-trust"]);
    assert.equal(ok.exit.code, 0, ok.stderr);
    const completedStops = ok.stderr.match(/^hook: Stop Completed$/gm) || [];
    const failedStops = ok.stderr.match(/^hook: Stop Failed$/gm) || [];
    assert.equal(completedStops.length, 3, `expected 3 completed Stop hooks; stderr:\n${ok.stderr}`);
    assert.equal(failedStops.length, 0, `unexpected failed Stop hooks; stderr:\n${ok.stderr}`);
    assert.match(ok.stderr, /^hook: SessionStart Completed$/m, ok.stderr);

    // 2. Stale trusted_content_hash (e.g., from an earlier installed plugin version) reproduces Stop Failed x3.
    const configPath = path.join(codexHome, "config.toml");
    const staleHash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    appendFileSync(configPath, [
      "",
      '[hooks.state."bearing-lite@bearing-lite:hooks/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:55325932f7df937eff5c1eaf9b42de779b30a5175803cd4e80aa40b9b1f4af51"',
      `trusted_content_hash = "${staleHash}"`,
      "",
      '[hooks.state."bearing-lite@bearing-lite:hooks/hooks.json:stop:0:0"]',
      'trusted_hash = "sha256:86644f9053227947c121da584e0aa24964d4be6dd11a9be7c77387da6bff58d2"',
      `trusted_content_hash = "${staleHash}"`,
      "",
      '[hooks.state."bearing-lite@bearing-lite:hooks/hooks.json:stop:1:0"]',
      'trusted_hash = "sha256:445f36137eafaaccf762da778134cf052729f62d01fe974d9bb0cbf71f13062a"',
      `trusted_content_hash = "${staleHash}"`,
      "",
      '[hooks.state."bearing-lite@bearing-lite:hooks/hooks.json:stop:2:0"]',
      'trusted_hash = "sha256:b2347d1451c5ec4936abebe87f3d356ff28350b3559915548243c253164ad101"',
      `trusted_content_hash = "${staleHash}"`,
      "",
    ].join("\n"));
    assert.ok(readFileSync(configPath, "utf8").includes(staleHash));
    const stale = await withLoopbackCodex(repo, env, []);
    assert.equal(stale.exit.code, 0, stale.stderr);
    const staleFailedStops = stale.stderr.match(/^hook: Stop Failed$/gm) || [];
    assert.equal(staleFailedStops.length, 3, `expected 3 failed Stop hooks on stale trust hash; stderr:\n${stale.stderr}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
